var fs = require('fs'),
  path = require('path'),
  exec = require('child_process').exec,
  _ = require('lodash'),
  pm = require('./pm'),
  conf = require('./util/conf'),
  dgram = require('dgram'),
  async = require('async'),
  url = require('url'),
  util = require('util'),
  chalk = require('chalk'),
  Log = require('./util/log'),
  stat = require('./stat');


module.exports = Monitor;

/**
 * Monitor of project monitor web.
 * @param options
 * @returns {Monitor}
 * @constructor
 */
function Monitor(options) {
  if (!(this instanceof Monitor)) {
    return new Monitor(options);
  }
  // Initializing...
  this._init(options);
};

Monitor.ACCEPT_KEYS = ['pm2', 'refresh', 'statsd', 'node', 'log', 'daemonize', 'max_restarts'];
Monitor.DEF_CONF_FILE = 'pm2-ant.ini';
Monitor.PM2_DAEMON_PROPS = ['DAEMON_RPC_PORT', 'DAEMON_PUB_PORT']

// Graphite configs.
// pm2.<node_name>.<app_name>.<pm_id>
Monitor.PREFIX = 'pm2.%s.%s.%d';
Monitor.PREFIX_WITHOUT_ID = 'pm2.%s.%s';
Monitor.PREFIX_NODENAME = 'pm2.%s';
Monitor.GRAPHITE_UPTIME = '.uptime';
Monitor.GRAPHITE_PLANNED_RESTART = '.planned_restart_count';
Monitor.GRAPHITE_UNSTABLE_RESTART = '.unstable_restart_count';
// .event.<event_name>
Monitor.GRAPHITE_EVENT = '.event.%s';

/**
 * Resolve home path.
 * @param {String} pm2Home
 * @returns {*}
 * @private
 */
Monitor.prototype._resolveHome = function (pm2Home) {
  if (pm2Home && pm2Home.indexOf('~/') == 0) {
    // Get root directory of PM2.
    pm2Home = process.env.PM2_HOME || path.resolve(process.env.HOME || process.env.HOMEPATH, pm2Home.substr(2));

    // Make sure exist.
    if (!pm2Home || !fs.existsSync(pm2Home)) {
      throw new Error('PM2 root can not be located, try to initialize PM2 by executing `pm2 ls` or set environment variable vi `export PM2_HOME=[ROOT]` in your terminal.');
    }
  }
  return pm2Home;
}

/**
 * Initialize options and configurations.
 * @private
 */
Monitor.prototype._init = function (options) {
  options = options || {};

  defConf = conf.File(options.confFile || path.resolve(__dirname, '..', Monitor.DEF_CONF_FILE)).loadSync().valueOf();
  defConf = _.pick.call(null, defConf, Monitor.ACCEPT_KEYS);

  options = _.pick.apply(options, Monitor.ACCEPT_KEYS).valueOf();
  options = _.defaults(options, defConf);

  options.pm2 = this._resolveHome(options.pm2);
  Log(options.log);

  // Load PM2 config.
  var pm2ConfPath = path.join(options.pm2, 'conf.js'),
    fbMsg = '';
  try {
    options.pm2Conf = require(pm2ConfPath)(options.pm2);
    if (!options.pm2Conf) {
      throw new Error(404);
    }
  } catch (err) {
    var fbMsg = 'Can not load PM2 config, the file "' + pm2ConfPath + '" does not exist or empty, fallback to auto-load by pm2 home. ';
    console.warn(fbMsg);
    options.pm2Conf = {
      DAEMON_RPC_PORT: path.resolve(options.pm2, 'rpc.sock'),
      DAEMON_PUB_PORT: path.resolve(options.pm2, 'pub.sock'),
      PM2_LOG_FILE_PATH: path.resolve(options.pm2, 'pm2.log')
    };
  }

  Monitor.PM2_DAEMON_PROPS.forEach(function (prop) {
    var val = options.pm2Conf[prop]
    if (!val || !fs.existsSync(val)) {
      throw new Error(fbMsg + 'Unfortunately ' + (val || prop) + ' can not found, please makesure that your pm2 is running and the home path is correct.')
    }
  })
  // Bind to context.
  this.options = options;
  Object.freeze(this.options);
};

/**
 * Run monitor.
 * @return {[type]} [description]
 */
Monitor.prototype.run = function () {
  var nodeName = this.options.node,
    waterfalls = [],
    pm2Daemon = this.options.pm2Conf.DAEMON_PUB_PORT,
    statsdUri = url.parse('udp://' + this.options.statsd),
    sock = {
      client: dgram.createSocket('udp4'),
      port: statsdUri.port,
      hostname: statsdUri.hostname
    };

  if (!nodeName) {
    this._getHostName(this._observePM2.bind(null, pm2Daemon, sock));
  } else {
    this._observePM2(pm2Daemon, sock, nodeName);
  }

  this._pollMonitInfo(pm2Daemon, sock, nodeName);
  this._pollSysInfo(pm2Daemon, sock, nodeName);
  
  this.statsdSock = sock;
  console.info('Already running.');
};

/**
 * Quit monitor.
 * @return {[type]} [description]
 */
Monitor.prototype.quit = function () {
  console.debug('Closing pm2 pub emitter socket.');
  this.pm2Sock && this.pm2Sock.close();
  console.debug('Closing statsd dgram socket.');
  this.statsdSock && this.statsdSock.client.close();
};

/**
 * Get host name by `hostname` cmd.
 * @param  {Function} cb Callback function
 * @return {[type]}      [description]
 */
Monitor.prototype._getHostName = function (cb) {
  exec('hostname', function (err, outprint, errprint) {
    if (err || !outprint) {
      return cb('Unknown');
    }
    return cb(outprint.replace(/\\n/g, ''));
  })
};

/**
 * Observe PM2 events.
 * @param  {String}   pm2Daemon unix socket path of PM2 daemon
 * @param  {SocketClient} sock socket client of statsD
 * @param  {String}   name node name
 * @return {[type]}        [description]
 */

Monitor.prototype._observePM2 = function (pm2Daemon, sock, name) {
  console.info('Connecting to pm2 daemon:', pm2Daemon);
  this.pm2Sock = pm.sub(pm2Daemon, function (e) {
    var prefix = util.format(Monitor.PREFIX, name, slug(e.process.name), e.process.pm_id),
      prefixWithoutId = util.format(Monitor.PREFIX_WITHOUT_ID, name, slug(e.process.name));
    // graphite counter.
    var postfix = util.format(Monitor.GRAPHITE_EVENT, e.event) + ':1|c';
    var data = prefix + postfix;
    data += '\n' + prefixWithoutId + postfix;
    if (e.event == 'exit') {
      // uptime.
      postfix = Monitor.GRAPHITE_UPTIME + ':' + (e.at - e.process.pm_uptime) + '|ms';
      data += '\n' + prefix + postfix;
      data += '\n' + prefixWithoutId + postfix;
      // planned restarts.
      postfix = Monitor.GRAPHITE_PLANNED_RESTART + ':' + e.process.restart_time + '|g';
      data += '\n' + prefix + postfix;
      data += '\n' + prefixWithoutId + postfix;
      // unstable restarts.
      postfix = Monitor.GRAPHITE_UNSTABLE_RESTART + ':' + e.process.unstable_restarts + '|g';
      data += '\n' + prefix + postfix;
      data += '\n' + prefixWithoutId + postfix;
    }
    var buf = new Buffer(data);
    sock.client.send(buf, 0, buf.length, sock.port, sock.hostname);
    console.debug('Sent', data.split(/\n/).join(' '));
  });
};

Monitor.prototype._pollMonitInfo = function (pm2Daemon, sock, name) {
  console.info('Connecting to pm2 daemon:', pm2Daemon);
  var me = this;
  var timer = setTimeout(function () {
    pm.list(me.options.pm2Conf.DAEMON_RPC_PORT, function (err, procs) {

      if (!!procs) {
        var data = '';
        // var system=sysinfo.system;
        // var cpu = cpuUsage(system.cpus);
        // var memory = memoryUsage(system.memory);
        // var prefixeNode = util.format(Monitor.PREFIX_NODENAME, name);
        // data += '\n' + prefixeNode + '.cpu:' + cpu + '|g';
        // data += '\n' + prefixeNode + '.memory:' + memory + '|g';
        //var procs = sysinfo.processes;
        procs.forEach(function (pro) {
          var prefix = util.format(Monitor.PREFIX, name, slug(pro.name), pro.pm_id);
          //info += 'app:' + pro.name + ',cpu:' + pro.monit.cpu + ',mem:' + pro.monit.memory + '\n';
          data += '\n' + prefix + '.cpu:' + pro.monit.cpu + '|g';
          data += '\n' + prefix + '.memory:' + pro.monit.memory + '|g';
        });

        var buf = new Buffer(data);
        sock.client.send(buf, 0, buf.length, sock.port, sock.hostname);
        console.debug('Sent', data);
      }
      else {
        console.debug('Sent', 'system data is null');
      }
      clearTimeout(timer);
      me._pollMonitInfo(pm2Daemon, sock, name);
    })
  }, me.options.refresh);
};


Monitor.prototype._pollSysInfo = function (pm2Daemon, sock, name) {
  console.info('Connecting to pm2 daemon:', pm2Daemon);
  var me = this;
  var timer = setTimeout(function () {

    stat.cpuUsage(function (err, cpuUsage) {
      var data = '';
      var mem = stat.memory;
      var memoryUsage = mem.total - mem.free;
      var prefixeNode = util.format(Monitor.PREFIX_NODENAME, name);
      data += '\n' + prefixeNode + '.cpu:' + cpuUsage + '|g';
      data += '\n' + prefixeNode + '.memory:' + memoryUsage + '|g';

      var buf = new Buffer(data);
      sock.client.send(buf, 0, buf.length, sock.port, sock.hostname);
      console.debug('Sent', data);

      clearTimeout(timer);
      me._pollSysInfo(pm2Daemon, sock, name);

    }, this)
  }, me.options.refresh);
};


function slug(str) {
  if (!str) {
    return '';
  }
  return str.replace(/\s+/g, '_');
}



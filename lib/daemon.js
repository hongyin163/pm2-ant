var chalk = require('chalk'),
  path = require('path'),
  fs = require('fs'),
  async = require('async'),
  cp = require('child_process'),
  fork = cp.fork,
  spawn = cp.spawn,
  Monitor = require('./monitor'),
  Log = require('./util/log');

var processDirname = path.resolve(__dirname, '../'),
  confFile = './pm2-ant.ini';

if (process.argv.length > 3) {
  confFile = process.argv[3];
}

confFile = path.resolve(processDirname, confFile);

if (!fs.existsSync(confFile)) {
  console.error(chalk.bold(confFile), chalk.red('does not exist!'));
  return process.exit(0);
}

var monitor = Monitor({
    confFile: confFile
  }),
  options = monitor.options;

Log(options.log);

var pidfile = path.resolve(processDirname, './pm2-ant.pid');

var Daemon = {
  restarts: 0,
  init: function (next) {
    process.on('SIGTERM', Daemon.stop);
    process.on('SIGINT', Daemon.stop);
    process.on('SIGHUP', Daemon.restart);
    next && next();
  },
  start: function (next) {
    Daemon.worker = Daemon.fork();
    next && next();
  },
  restart: function () {
    console.info('Restarting...');
    Daemon.kill();
    Daemon.start();
  },
  stop: function () {
    console.info('Stopping...');
    Daemon.kill();
    options.daemonize && fs.existsSync(pidfile) && fs.unlinkSync(pidfile);
    process.exit(0);
  },
  kill: function () {
    if (Daemon.timer) {
      clearTimeout(Daemon.timer);
      Daemon.timer = null;
    }
    if (Daemon.worker) {
      Daemon.worker.suicide = true;
      Daemon.worker.kill();
    }
  },
  fork: function () {
    console.info('Forking slave...');
    Daemon.timer = null;
    var worker = fork(path.resolve(processDirname, 'pm2-ant.js'), [confFile, '--color'], {
      silent: monitor.options.daemonize,
      env: process.env
    });
    worker.on('exit', function (code, signal) {
      if (code != 0) {
        if (Daemon.restarts < 10) {
          Daemon.restarts++;
          setTimeout(function () {
            Daemon.restarts--;
          }, 20000);
        } else {
          console.error(Daemon.restarts + ' restarts in 20 seconds, view the logs to investigate the crash problem.');
          return process.exit(0);
        }
      }
      if (!worker.suicide && code !== 0) {
        Daemon.timer = setTimeout(Daemon.fork, 3000);
      }
    });

    worker.on('message', function (message) {
      if (typeof message == 'object' && message.action)
        if (message.action == 'restart') {
          Daemon.restart();
        }
    });

    var logDir = monitor.options.log.dir,
      stdout = 'pm2-ant.out',
      stderr = 'pm2-ant.err';

    if (!logDir) {
      logDir = './logs';
    }

    logDir = path.resolve(processDirname, logDir);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }

    if (monitor.options.daemonize) {
      stdout = fs.createWriteStream(path.join(logDir, stdout));
      stderr = fs.createWriteStream(path.join(logDir, stderr));
      worker.stdout.pipe(stdout);
      worker.stderr.pipe(stderr);
      fs.writeFile(pidfile, worker.pid);
    }

    return worker;
  },
  daemonize: function () {
    if (process.env.daemonized) {
      console.info('Daemonized with pid [' + process.pid + '].');
      return;
    }
    console.info('Spawning daemon...');
    var args = [].concat(process.argv);
    args.shift();
    var env = process.env;
    env.daemonized = true;
    var child = spawn(process.execPath, args, {
      env: env,
      detached: false,
      cwd: processDirname,
      stdio: ['ignore', process.stdout, process.stderr]
    });
    child.unref();
    process.exit();
  }
};
if (monitor.options.daemonize) {
  Daemon.daemonize();
}

process.title = 'pm2-ant daemon';
async.series([
  Daemon.init,
  Daemon.start
], function (err) {
  if (err) {
    console.error(err.stack);
  }
});

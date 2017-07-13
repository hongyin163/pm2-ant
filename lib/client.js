var dgram = require('dgram'),
    url = require('url'),
    util = require('util'),
    Falcon = require('node-open-falcon'),
    ip = require('ip');

var PREFIX = 'pm2.%s.%s.%d.';
var PREFIX_NODENAME = 'pm2.%s.';
var hostip = ip.address();

var sender = {
    client: null,
    "falcon": {
        send: function (uri, data) {

            //event,process,system
            if (!this.client) {
                this.client = new Falcon({
                    endpoint: hostip,
                    api: uri
                })
            }

            //event
            if (data.event) {
                this.client
                    .metric('event.' + data.event, 1)
                    .tags({ id: data.pm_id, app: data.app_name })
                    .end();
            }

            //proces
            if (data.process) {

                for (var ev in data.process) {
                    this.client
                        .metric("proc." + ev, data.process[ev])
                        .tags({ id: data.pm_id, app: data.app_name })
                        .end();
                }
            }

            //system
            if (data.system) {
                for (var ev in data.system) {
                    this.client
                        .metric("system." + ev, data.system[ev])
                        .tags({ id: data.pm_id, app: data.app_name })
                        .end();
                }
            }
            this.client.send();
            console.log('falcon|' + 'uri:' + uri + 'data:' + JSON.stringify(data));
        },
        close: function () { }
    },
    "statsd": {
        client: null,
        send: function (uri, data) {

            var prefix = util.format(PREFIX, data.node_name, data.app_name, data.pm_id)
            var result = '';
            //event,process,system
            if (!this.client) {
                this.client = dgram.createSocket('udp4');
            }

            //event
            if (data.event) {
                result += '\n' + prefix + '.event.' + data.event + ':1|c';
            }

            //proces
            if (data.process) {
                for (var ev in data.process) {
                    if (ev == 'uptime') {
                        result += '\n' + prefix + '.' + ev + ":" + data.process[ev] + '|ms';
                    }
                    else {
                        result += '\n' + prefix + '.' + ev + ":" + data.process[ev] + '|g';
                    }
                }

            }
            var prefixeNode = util.format(PREFIX_NODENAME, data.node_name);
            //system
            if (data.system) {
                for (var ev in data.system) {
                    result += '\n' + prefixeNode + '.' + ev + ":" + data.system[ev] + '|g';
                }
            }
            var buf = new Buffer(result);
            var u = url.parse(uri);
            this.client.send(buf, 0, buf.length, u.port, u.hostname);

            console.log('statsd|' + 'uri:' + uri + 'data:' + result);
        },
        close: function () {
            this.client.close();
        }
    }
}
//falcon[http://127.0.0.1:5258]
var client = {
    send: function (uri, data) {
        var type = uri.substring(0, uri.indexOf('['));
        var url = uri.match(/\[([^\]]*)\]/)[1];
        sender[type].send(uri, data);
    },
    close: function () {
        sender[type].close();
    }
}


module.exports = client;
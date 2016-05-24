var fs = require('fs'),
    path = require('path');

var tpl = fs.readFileSync('./pm2-ant.ini.tpl')
    .toString();

function getIPAdress() {
    var interfaces = require('os').networkInterfaces();
    for (var devName in interfaces) {
        var iface = interfaces[devName];
        for (var i = 0; i < iface.length; i++) {
            var alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
}

function getFormatIP() {
    return getIPAdress().split('.').join('_');
}


function init() {
    var hostip, statsd;
    if (process.argv.length > 3 && process.argv[3].length > 0) {
        hostip = process.argv[3];
    }
    if (process.argv.length > 4 && process.argv[4].length > 0) {
        statsd = process.argv[4];
    }

    if (!hostip)
        hostip = getFormatIP();

    if (!statsd)
        statsd = '127.0.0.1:8125';

    var result = tpl
        .replace('{IP}', hostip)
        .replace('{STATSD_IP:PORT}', statsd);

    fs.writeFile('./pm2-ant.ini', result, (err) => {
        if (err) throw err;
        console.log('It\'s saved!');
    });
}

if (path.basename(process.mainModule.filename, '.js') == 'init') {

    init();
    // exports.start();
}

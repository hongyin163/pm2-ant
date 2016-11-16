var fs = require('fs'),
    path = require('path');



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
    var tplpath = path.resolve(__dirname, '../pm2-ant.ini.tpl');
    var tpl = fs.readFileSync(tplpath)
        .toString();

    var hostip, client, uri;
    if (process.argv.length > 3 && process.argv[3].length > 0) {
        hostip = process.argv[3];
    }
    if (process.argv.length > 4 && process.argv[4].length > 0) {
        client = process.argv[4];
    }
    if (process.argv.length > 5 && process.argv[5].length > 0) {
        uri = process.argv[5];
    }

    if (!hostip)
        hostip = getFormatIP();

    if (!client) {
        client = 'falcon';
    }

    if (client == 'falcon') {
        uri = uri || 'http://127.0.0.1:5258';
        if (uri.indexOf('http') < 0) {
            uri = "http://" + uri;
        }
    } else if (client == 'statsd') {
        uri = uri || 'udp://127.0.0.1:8125';
        if (uri.indexOf('udp') < 0) {
            uri = "upd://" + uri;
        }
    }

    var result = tpl
        .replace('{IP}', hostip)
        .replace('{NAME[PROTOCOL://IP:PORT]}', client + '[' + uri + ']');

    var iniPath = path.resolve(__dirname, '../pm2-ant.ini');
    fs.writeFile(iniPath, result, (err) => {
        if (err) throw err;
        console.log('It\'s saved!');
    });
}

if (path.basename(process.mainModule.filename, '.js') == 'init') {

    init();

}

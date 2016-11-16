node = {IP}
pm2 = ~/.pm2
refresh = 5000
target = {NAME[PROTOCOL://IP:PORT]}
daemonize = true

[log]
dir = ./logs
prefix = true
date = false
level = debug
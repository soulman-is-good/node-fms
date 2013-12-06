#!/usr/bin/env node
// Server.js (упрощённый)
var cluster = require('cluster');
var fs = require('fs');
var config = {
    numWorkers: require('os').cpus().length
};

cluster.setupMaster({
    exec: "worker.js"
});
function length(obj){
    var c = 0;
    for(i in obj) c++;
    return c;
}
if(cluster.isMaster && !fs.existsSync('/var/lock/fcfs.pid')) {
    // Fork workers as needed.
    if(length(cluster.workers) < config.numWorkers){
        for (var i = 0; i < config.numWorkers; i++)
            cluster.fork();

        cluster.on('exit', function(worker, code, signal) {
            if(worker.suicide === true) {
                console.log('worker ' + worker.process.pid + ' suicide...');
            }else {
                console.log('worker ' + worker.process.pid + ' died('+code+')...spawn a new one...');
                cluster.fork();
            }
        });
        cluster.on('listening',function(worker, address){
            console.log('Worker pid#' + worker.process.pid + ' listening on ' + address.address + ':' + address.port);
        });
        fs.writeFile('/var/lock/fcfs.pid',process.pid);
        process.on('exit',function(){
            fs.unlinkSync('/var/lock/fcfs.pid');
        })
    }
}else {
    console.log('Process locked...');
}
var application = function(){}

application.init = function(config){
  return function(req, res, next) {
    //Forbid not allowed ips
    function getIp() {
      return req.connection.remoteAddress || req.header['X-Forwarded-For'];
    }

    function ipAllowed(ip) {
      var allowed = false;
      for (var i = 0; i < config.allowedIp.length; i++) {
        if (ip === config.allowedIp[i]) {
          allowed = true;
          break;
        }
      }
      return allowed;
    }

    var requestIp = getIp();
    if (!ipAllowed(requestIp)) {
      res.writeHead(403, {'Content-type': 'plain/text', 'Content-Length': 9})
      res.write('Forbidden');
      res.end();
//      var err = new Error('Forbidden');
//      err.status = 403;
    } else {
      next();
    }
  }
}
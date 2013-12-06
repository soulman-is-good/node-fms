var EventEmitter = require('events').EventEmitter;
var tedious = require('tedious');
var TYPES = tedious.TYPES;
var deferred = require('defer');
/**
 * MSSQL Database connector via Tedious module (http://pekim.github.io/tedious/)
 *
 * @todo Model mapping per query execution to save execution time.
 * @copyright Facecom LLC
 */
var DB = function () {
  var bConnected = false;
  var bTransaction = false;
  var transaction_stack = {};
  var query_stack = {};
  var config = {
    server: '144.76.74.46',
    userName: "php",
    password: "12Kjgfnf12",
    options: {
      port: 45045,
      database: 'Aua.Facecom'
      // , debug: {
      //     packet: true,
      //     data: true,
      //     payload: true,
      //     token: false,
      //     log: true
      // }
    }
  };

  this.isConnected = function () {
    return bConnected;
  };

  this.connect = function (callback) {
    callback = callback || function () {
    };
    var connection = new tedious.Connection(config);
    this.emit('connect', connection);
    if (callback) {
      connection.on('connect', function (err) {
        callback(err, connection);
      });
    }
    connection.on('debug', function (text) {
      //console.info(text);
    });

    bConnected = true;
    return connection;
  };

  this.close = function (connection) {
    var self = this;
    if (Object.keys(query_stack).length === 0) {
      //emits when all connections had passed by
      self.emit('done');
    }
    if (connection) {
      connection.close();
      bConnected = false;
    }
  };

  this.query = function (sql, cachetime, params, callback) {
    var defer = new deferred();
    callback = callback || function () {
    };
    var result = {data: [], params: {}};
    var self = this;
    if (typeof cachetime === 'function') {
      callback = cachetime;
      params = undefined;
      cachetime = undefined;
    } else if (typeof cachetime === 'object') {
      callback = params;
      params = cachetime;
      cachetime = undefined;
      if (typeof params === 'function') {
        callback = params;
        params = {};
      }
    } else if (typeof params === 'function') {
      callback = params;
      params = {};
    }
    callback = callback || function(){};
    params = prepareParams(params);
    var key = prepareHash(sql, params);
    var execute = function () {
      self.connect(function (err, connection) {
        if (err) {
          bConnected = false;
          callback(err, result);
          defer.reject();
        } else {
          var request = new tedious.Request(sql, function (err, rowCount) {
            if (!isNaN(cachetime)) {
              ncache.set(key, result, cachetime, function (err, success) {
                if (err || !success) {
                  console.warn('Error writing cache ' + key + ':', err, success)
                }
              });
            }
            defer.resolve();
            delete query_stack[key];
            callback(err, result);
            self.close(connection);
          });
          transaction_stack[key] = request;
          query_stack[key] = request;
          request = prepareRequest(request, params);
          request.on('row', function (columns) {
            var obj = {};
            for (var i in columns) {
              var column = columns[i];
              obj[column.metadata.colName] = column.metadata;
            }
            result.data.push(obj);
          });

          request.on('returnValue', function (paramName, val, metadata) {
            result.params[paramName] = val;
          });
          connection.execSql(request);
        }
      });
    };
    if (typeof cachetime === 'undefined') {
      execute();
    } else if (!isNaN(cachetime)) {
      //get data from cache
      query_stack[key] = 'cache';
      ncache.get(key, function (err, value) {
        if (!err && value.hasOwnProperty(key)) {
          defer.resolve();
          delete query_stack[key];
          self.close();
          callback(null, value[key]);
        } else {
          //get data from db if error occur
          execute();
        }
      });
    } else {
      //not a number then get from db
      execute();
    }
    return defer.promise();
  };

  this.exec = function (procName, cachetime, params, callback) {
    callback = callback || function () {
    };
    var self = this;
    var result = {data: [], params: {}, status: 0};
    var defer = new deferred();
    if (typeof cachetime === 'function') {
      callback = cachetime;
      params = undefined;
      cachetime = undefined;
    } else if (typeof cachetime === 'object') {
      callback = params;
      params = cachetime;
      cachetime = undefined;
      if (typeof params === 'function') {
        callback = params;
        params = {};
      }
    } else if (typeof params === 'function') {
      callback = params;
      params = {};
    }
    callback = callback || function(){};
    params = prepareParams(params);
    var key = prepareHash(procName, params);
    var execute = function () {
      self.connect(function (err, connection) {
        console.info('START:' + procName);
        if (err) {
          defer.reject();
          callback(err);
          bConnected = false;
        } else {
          var request = new tedious.Request(procName, function (err, rowCount) {
            delete query_stack[key];
            //Deadlock - redo query
            if (result.status === 1205) {
              console.error(procName, "deadlock");
              self.exec(procName, cachetime, params, callback);
            } else {
              if (result.data.length == 1) {
                result.data = result.data[0];
              }
              if (!isNaN(cachetime)) {
                ncache.set(key, result, cachetime, function (err, success) {
                  if (err || !success) {
                    console.warn('Error writing cache ' + key + ':', err, success)
                  }
                });
              }
              defer.resolve();
              console.info('END:' + procName);
              callback(err, result);
              self.close(connection);
            }
          });
          console.info('HANDLE:' + procName);
          query_stack[key] = request;
          request = prepareRequest(request, params);
          var _data = [];
          request.on('row', function (columns) {
            var obj = {};
            for (var i in columns) {
              var column = columns[i];
              obj[column.metadata.colName] = column.value;
            }
            self.emit('row', obj);
            _data.push(obj);
          });

          request.on('doneInProc', function (rowCount, more, rows) {
            result.data.push(_data);
            _data = [];
          });

          request.on('doneProc', function (rowCount, more, returnStatus) {
            //unsigned to signed: x<<(sizeof(int)*CHAR_BIT - 16)>>(sizeof(int)*CHAR_BIT - 16);
            returnStatus = returnStatus << 16 >> 16;
            result.status = returnStatus;
          });

          request.on('returnValue', function (paramName, val, metadata) {
            result.params[paramName] = val;
          });
          connection.callProcedure(request);
        }
      });
    }
    if (typeof cachetime === 'undefined') {
      execute();
    } else if (!isNaN(cachetime)) {
      //get data from cache
      query_stack[key] = 'cache';
      ncache.get(key, function (err, value) {
        if (!err && value.hasOwnProperty(key)) {
          defer.resolve();
          delete query_stack[key];
          self.close();
          callback(null, value[key]);
        } else {
          //get data from db if error occure
          execute();
        }
      });
    } else {
      //not a number then get from db
      execute();
    }
    return defer.promise();
  };

  function prepareHash(sql, params) {
    var hash = require('crypto').createHash('sha1');
    params = params || {};
    hash.update(sql + JSON.stringify(params));
    return hash.digest("hex");
  }

  function prepareParams(params) {
    params = params || {};
    if (!params.hasOwnProperty('OUTPUT') && !params.hasOwnProperty('INPUT')) {
      params = {INPUT: params, OUTPUT: {}};
    }
    if (!params.hasOwnProperty('OUTPUT')) {
      params = {INPUT: params.INPUT, OUTPUT: {}};
    }
    if (!params.hasOwnProperty('INPUT')) {
      params = {OUTPUT: params.OUTPUT, INPUT: {}};
    }
    return params;
  }

  function prepareRequest(request, params) {
    var i = null;
    params = prepareParams(params);
    var input = params.INPUT;
    var output = params.OUTPUT;
    for (i in input) {
      var type = TYPES.NVarChar;
      var val = '';
      if (input[i] instanceof Array) {
        type = input[i].shift();
        val = input[i].shift();
      } else {
        type = resolveType(input[i]);
        val = input[i];
      }
      request.addParameter(i, type, val);
    }
    for (i in output) {
      var type = output[i];
      var val;
      if ('object' === typeof type) {
        val = type[1];
        type = type.shift();
      }
      request.addOutputParameter(i, type, val);
    }
    return request;
  }

  function resolveType(val) {
    switch (typeof val) {
      case "number":
        return TYPES.Int;
        break;
      case "string":
        return TYPES.NVarChar;
        break;
      default:
        return TYPES.NVarChar;
    }
  }

};

DB.prototype.__proto__ = EventEmitter.prototype;

module.exports = new DB();

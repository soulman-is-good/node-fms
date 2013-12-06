/**
 * File server worker for facecom
 * @author Maxim Savin <i@soulman.kz>
 */
var cluster = require('cluster');
var http = require('http');
var sys = require("sys");
var events = require("events");
var fs = require("fs");
var mime = require("mime");
var mmm = require('mmmagic'),
    Magic = mmm.Magic;
var magic = new Magic(mmm.MAGIC_MIME_TYPE);
var db = require("./lib/db");
var fsrv = require("./lib/app");
var connect = require('connect'),
  app = connect();


const IS_DEBUG = true;

var config = require('./config');

var sizes = require('./sizes').images;

var video_sizes = require('./sizes').video;

/**console.log debug override*/
(function(){
  var log = console.log;
  console.log = function(){
    if(IS_DEBUG) {
      log.apply(this, arguments);
    }
  }
})();


app.use(connect.logger('dev'));
app.use(connect.static('upload'));
app.use(connect.direcory('./upload/photos'));
app.use(connect.bodyParser());
//file server logic:
app.use(fsrv.init(config));

/**
 * Run server.
 */
http.createServer(app).listen(config.port,config.server);

var srv = http.createServer(function (req, res) {

  var url_path = require("url").parse(req.url);
  var url = uri.pathname;
  var uri = url.split('/');
  uri.shift();
  uri.shift();
  req.isNewServer = url_path.query.indexOf('new')!==-1?true:false
  try {
    if (uri.length > 1) {
      switch (uri[1]) {
        case 'put':
          if (req.method.toLowerCase() == "post" && (uri[0] === 'music' || uri[0] === 'photos' || uri[0] === 'video' || uri[0] === 'doc')) {
            IS_DEBUG && console.log(uri[0] + ' upload started...  ')
            upload_file(uri[0], req, res, function (files) {
              if (uri[0] === 'video') {
                console.log('Going to convert video...');
                convert_video(files);
              }
              if (files.length == 1)
                files = files.shift();
              var msg = JSON.stringify(files);
              console.log('\t...files has been uploaded!');
              res.writeHead(200, {
                'Content-Length': msg.length,
                'Content-type': 'application/json'
              });
              res.write(msg);
              res.end();
            });
          } else {
            show_404(req, res, 'No POST Data');
          }
          break;
        case 'update':
          //TODO: Only for photos yet
          if (req.method.toLowerCase() === "get" && uri[0] === 'photos') {
            IS_DEBUG && console.log('Update requested.');
            var query = require("querystring").parse(require("url").parse(req.url).query);
            if (!query['file'] || !query['thumb']) {
              show_404(req, res, 'No file specified for update operation.');
            } else {
              var from = !!query['from'] ? query['from'] + '/' : '';
              var thumbs = query['thumb'].split(',');
              var file = query['file'];
              var src = './upload/photos/' + from + file;
              var width = !!query['width'] ? query['width'] : false;
              var height = !!query['height'] ? query['height'] : false;
              var left = !!query['left'] ? query['left'] : '0';
              var top = !!query['top'] ? query['top'] : '0';
              if (width > 4096 || height > 4096 || left > width || top > height) {
                show_404(req, res, 'Wrong resize parameters.');
              } else {
                fs.exists(src, function (ex) {
                  if (ex) {
                    var count = thumbs.length;
                    for (i in thumbs) {
                      var thumb = thumbs[i].replace(/^[\s]+|[\s]+$/, '');
                      if (!!sizes[thumb]) {
                        var dst = './upload/photos/' + thumb;
                        !fs.existsSync(dst, function (err) {
                        }) && fs.mkdirSync(dst, 0777);
                        var ftype = mime.lookup(url);
                        var im = require('imagemagick');
                        var csize = sizes[thumb].join('x') + '+' + left + '+' + top
                        var size = (width > 0 & height > 0) ? width + 'x' + height : sizes[thumb].join('x');
                        console.log(csize, size, file);
                        //resize
                        im.convert([src, '-resize', size, '-crop', csize, '-unsharp', '0x1', '-support', '0.1', dst + '/' + file],
                          function (err, stdout) {
                            if (err) {
                              show_404(req, res, err);
                            } else {
                              //                                                        if(thumbs.length == 1)
                              //                                                            read_file(req, res, dst.replace(/^\./,'') + '/' + file);
                              //                                                        else
                              IS_DEBUG && console.log("\t..." + thumb + " OK!");
                            }
                            count--;
                          });
                      } else {
                        IS_DEBUG && console.log("\t..." + thumb + " NO SUCH THUMB!");
                      }
                    }
                    function wait_till_resize() {
                      if (count > 0)
                        setTimeout(function () {
                          wait_till_resize(res)
                        }, 10);
                      else
                        res.end();
                    }

                    setTimeout(function () {
                      wait_till_resize(res)
                    }, 10);
                  } else {
                    show_404(req, res, 'No "' + src + '" file exists!');
                  }
                });
              }
            }
          } else {
            show_404(req, res, 'No GET Data for update or not a photo');
          }
          break;
        default:
          if (req.method.toLowerCase() == "get") {
            IS_DEBUG && console.log(url + ' file requested...');
            fs.exists("." + url, function (exists) {
              //if file exists then pipe it up
              if (exists) {
                read_file(req, res, url);
              } else if (uri[0] === 'photos' && uri.length == 3) {
                //else if we have the size and the source file exists
                IS_DEBUG && console.log('\t...does not exists, try to resize...');
                var presize = uri[1];
                if (!sizes[presize]) {
                  show_404(req, res, '\t...no such thumb name "' + presize + '"');
                  return;
                }
                var size = sizes[presize].join('x');
                var src = './upload/photos/' + uri[2];
                fs.exists(src, function (ex) {
                  if (ex) {
                    !fs.existsSync('./upload/photos/' + presize, function (err) {
                    }) && fs.mkdirSync('./upload/photos/' + presize, 0777);
                    //get info
                    var ftype = mime.lookup(url);
                    var im = require('imagemagick');
                    //resize
                    im.convert([src, '-resize', size + '^', '-gravity', 'center', '-extent', size, '-unsharp', '0x1', '.' + url],
                      function (err, stdout) {
                        if (err) {
                          show_404(req, res, err);
                        } else {
                          IS_DEBUG && console.log('\t...OK!');
                          read_file(req, res, url);
                        }
                      });
                  } else {
                    show_404(req, res, '\t... no source file "' + src + '" exists!');
                  }

                });
              } else if (uri[0] === 'qrcode') {
                var id = uri[1];
                var QRCode = require('qrcode');
                var link = 'http://facecom.info/use/' + id.split('.').shift();
                IS_DEBUG && console.log('QRCode generation for text ' + link);
                QRCode.save('upload/qrcode/' + id, link, {errorCorrectLevel: 'minimum'}, function (err, written) {
                  if (!!err) {
                    console.log('QRCode', err);
                    show_404(req, res, 'Error generating QRCode');
                  } else if (written > 0) {
                    read_file(req, res, url);
                  } else {
                    console.log('0 bytes was written...');
                  }
                });
              } else {
                //we haven't found the file
                IS_DEBUG && console.log('\t...does not exists at all!');
                show_404(req, res);
              }
            })
          } else {
            show_404(req, res, "Not a GET request for get url");
          }

          break;
      }
    } else {
      show_404(req, res, 'URL too short: ' + url);
    }
  } catch (err) {
    console.log(err);
  }
}).listen(config.port, config.server);

//console.log('Worker started at: '+config.server+':'+config.port);

/*
 * Handle file upload
 */
function upload_file(type, req, res, cb) {
  // Request body is binary
  // req.setEncoding("binary");
  var filename = false;
  var formidable = require('formidable')
  var form = new formidable.IncomingForm();
  form.hash = 'sha1';
  form.uploadDir = './upload/' + type;
  form.keepExtensions = true;
  form.parse(req);
  var files = [];
  var shasum = require('crypto').createHash('sha1');
  /**
   * Check uploaded file
   */
  form.on('file', function (field, file) {
    var ext = file.name.split('.').pop().replace(/^([a-zA-Z0-9]{3,4})(.*)/, "$1").toLowerCase();
    var ftype = mime.lookup(file.path);
    if (type === 'photos') {
      if (
        (type === 'photos' && ftype !== 'image/jpeg' && ftype !== 'image/png' && ftype !== 'image/gif') ||
          (type === 'music' && ext !== 'mp3' && ftype === 'audio/mpeg') ||
          (type === 'video' && ftype !== 'video/mp4' && ftype !== 'video/mpeg' && ftype !== 'video/x-msvideo' && ftype !== 'video/x-flv' && ftype !== 'video/3gpp')
        ) {
        fs.unlink(file.path, function (err) {
          if (err) console.log(err);
        });
        files.push({
          "filename": false,
          "error": 'Not an appropriate file type',
          "created": false
        });
        return false;
      }
    }
    var name = shasum.update(fs.readFileSync(file.path)).digest('hex') + '.' + ext;
    filename = './upload/' + type + '/' + name;
    //Check if file exists, we'll send it back;
    if (fs.existsSync(filename)) {
      if (IS_DEBUG) console.log("File: '" + filename + "' already exists.");
      fs.unlink(file.path, function (err) {
        if (err) console.log(err);
      });
      files.push({
        "filename": name,
        "error": false,
        "created": false
      });
      if(req.isNewServer) {
        go_add_mssql_record(name, file.size, type);
      } else {
        go_add_mysql_record(name, file.size, type);
      }
    } else {
      if (IS_DEBUG) console.log("File: '" + filename + "' uploaded!");
      fs.renameSync(file.path, filename);
      files.push({
        "filename": name,
        "error": false,
        "created": true
      });
      if(req.isNewServer) {
        go_add_mssql_record(name, file.size, type);
      } else {
        go_add_mysql_record(name, file.size, type);
      }
    }
    if (type === 'video') {
      var pname = filename.replace(/video/, 'photos').replace(/\.[a-z]+$/, '.jpg');
      require('child_process').exec('ffmpeg -i ' + filename + ' -an -ss 00:00:03 -t 00:00:01 -r 1 -y ' + pname, function (err, stdout, stderr) {
        if (err === null) {
          var duration = (/Duration: ([0-9:\.]), start/g).exec(stderr)
          console.log(duration);
        }
      });

    }
  });
  /**
   * Form progress
   */
  form.on('progress', function (bytesReceived, bytesExpected) {
    var percent = Math.round((bytesReceived / bytesExpected) * 100);
    percent = percent + '%';
    sys.print(repeatstr("\x08", percent.length) + percent);
  });
  /**
   * We got an error processing form
   */
  form.on('error', function (err) {
    // A request that experiences an error is automatically paused, you will have to manually call:
    //req.resume();
    console.log(err);
  });
  /**
   * User aborted the connection
   */
  form.on('aborted', function () {
    show_404(req, res, 'Aborted by User');
  });
  /**
   * We recieved all the files
   */
  form.on('end', function () {
    //		console.log(this,'form passed.');
    cb.call(form, files)
  });

  return;
}

function go_add_mysql_record(name, size, type) {
  var mysql = require('mysql');
  var connection = mysql.createConnection({
    host: config.mysql.server,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database
  });
  //insert data
  function save(name, type, size) {
    var connection = mysql.createConnection({
      host: config.mysql.server,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database
    });
    var timestamp = Math.round(new Date().getTime() / 1000);
    var data = {'id': name, 'filesize': size, 'type': type, 'created_at': timestamp};
    try {
      connection.query("INSERT INTO files SET ?", data, function (err) {
        if (err) {
          console.log("DB ERROR: ", err);
        } else {
          IS_DEBUG && console.log('DB INFO: Successfully inserted ' + name);
        }
        if (type === 'photos') {
          var connection = mysql.createConnection({
            host: config.mysql.server,
            user: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database
          });
          var ExifImage = require('exif').ExifImage;
          try {
            new ExifImage({ image: './upload/photos/' + name }, function (error, image) {
              if (error || !image.hasOwnProperty('gps')
                || !image.gps.hasOwnProperty('GPSLongitude') || !image.gps.hasOwnProperty('GPSLongitudeRef')
                || !image.gps.hasOwnProperty('GPSLatitude') || !image.gps.hasOwnProperty('GPSLatitudeRef')) {
              } else {
                var lon = getGps(image.gps.GPSLongitude, image.gps.GPSLongitudeRef);
                var lat = getGps(image.gps.GPSLatitude, image.gps.GPSLatitudeRef);
                var gpstime = image.gps.hasOwnProperty('GPSDateStamp') ? Math.round(new Date(image.gps.GPSDateStamp.value.replace(/:/g, '/')).getTime() / 1000) : timestamp;
                connection.query("INSERT INTO filemarks (`file_id`,`lat`,`long`,`zoom`,`created_at`,`status`) VALUES ('" + name + "','" + lat + "','" + lon + "','14','" + gpstime + "','1')", function (err) {
                  console.log("DB ERROR: ", err);
                });
                connection.end();
              }
            });
          } catch (error) {
            console.log('Error getting exif: ' + error.message);
          }
        }
      });
      connection.end();
    } catch (e) {
      console.log('DB ERROR:', e);
    }
  }

  function tryDb(connection, name, size, type, iter) {
    try {
      connection.connect();

      connection.query("SELECT COUNT(0) AS cnt FROM files WHERE id=?", [name], function (err, rows, fields) {
        if (err) {
          console.log("DB ERROR: ", err);
        }
        if (rows[0].cnt == 0) {
          save(name, type, size);
        }
      });

      connection.end();
    } catch (err) {
      if (iter < 3) {
        tryDb(connection, name, size, type, iter + 1);
      } else {
        console.log(err);
      }
    }
  }

  tryDb(connection, name, size, type, 0);
}
function go_add_mssql_record(name, size, type) {
  var procName;
  var q = {File: name, FileSize: size};

  function storeFile() {
    db.exec(procName,{File:name},function(err,result){
      if(err) {
        console.error(err);
      } else if(result.status !== 0) {
        console.error("MSSQL Post file error: ", result.status);
      }
    });
  }

  if(type === 'photos') {
    procName = 'storage.PostImage';
    storeFile();
  } else if(type === 'audio') {
    procName = 'storage.PostAudio';
    //TODO: q.FileLength =
  } else if(type === 'video') {
    procName = 'storage.PostVideo';
  } else if(type === 'doc') {
    procName = 'storage.PostDocument';
    //TODO: q.FileLength =
  } else {
    console.error("wrong type: " + type);
    return;
  }
}

function read_file(req, res, url) {
  fs.stat('.' + url, function (err, stats) {
    if (err) {
      show_404(req, res, err);
    } else {
      var ftype = mime.lookup(url);
      var x = req.headers['if-modified-since'];
      var m = new Date(stats.mtime).getTime();
      x = !!x && new Date(x).getTime();
      if (x !== false && x <= m) {
        res.writeHeader(304, {
          'Last-Modified': stats.mtime
        });
        res.end();
      } else {
        res.writeHeader(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': stats.size,
          'Content-type': ftype,
          'Last-Modified': stats.mtime
        });
        fs.createReadStream("." + url)
          .on("open", function (fd) {
            IS_DEBUG && console.log("\t...stream started.");
            this.pipe(res);
          })
          .on("error", function (err) {
            if (err)
              show_404(req, res, err);
            else {
              IS_DEBUG && console.log("\t...stream ended successfully.");
              res.end();
            }
          });
      }
    }
  });
}

function getGps(exifCoord, hemi) {
  var l = exifCoord.value.length;
  var degrees = l > 0 ? exifCoord.value[0] : 0;
  var minutes = l > 1 ? exifCoord.value[1] : 0;
  var seconds = l > 2 ? exifCoord.value[2] : 0;

  flip = (hemi.value == 'W' || hemi.value == 'S') ? -1 : 1;

  return flip * (degrees + minutes / 60 + seconds / 3600);
}

function convert_video(files) {
  function start_encode(dir, file, size) {
    var fname = dir + '/' + file;
    fname = fname.split('.');
    fname.pop();
    fname.push('flv');
    fname = fname.join('.');
    fs.exists(fname, function (exs) {
      if (!exs) {
        IS_DEBUG && console.log("\t...starting convert " + fname);
        var ffmpeg = require('child_process').spawn('ffmpeg', ['-i', './upload/video/' + file, '-ar', '22050', '-ab', '32k', '-f', 'flv', '-b', '700k', '-s', size, '-ac', '2', '-y', fname]);
      } else
        IS_DEBUG && console.log("\t...already exists " + dir + '/' + file);
    });
  }

  function check_dex(dsize, filename, res) {
    fs.exists(dsize, function (ex) {
      if (!ex) {
        fs.mkdir(dsize, 0777, function (err) {
          if (err) {
            console.log(err);
          } else {
            start_encode(dsize, filename, res);
          }
        });
      } else {
        start_encode(dsize, filename, res);
      }
    });
  }

  function check_fex(filename) {
    var file = './upload/video/' + filename;
    fs.exists(file, function (ex) {
      if (ex) {
        for (j in video_sizes) {
          //check if directory exists
          var dsize = './upload/video/' + j
          check_dex(dsize, filename, video_sizes[j]);
        }
      } else
        console.log('Original file does not exists! ' + file);
    })
  }

  for (i in files) {
    //check if original file is exists
    check_fex(files[i].filename, 1);
  }
}

//nah!
function repeatstr(str, cnt) {
  var res = str + ""; //stringify if not
  cnt--;
  for (i = 0; i < cnt; i++) res += str;
  return res;
}

/*
 * Handles page not found error
 */
function show_404(req, res, msg) {
  if (IS_DEBUG) console.log(msg);
  res.writeHead(404, {
    "Content-Type": "text/plain"
  });
  res.end();
}


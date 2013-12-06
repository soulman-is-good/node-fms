var debug = require('debug')('connect:session')
    , MSSQLStore = require('mssql-store')
    , signature = require('cookie-signature')
    , utils = require('../node_modules/connect/lib/utils')
    , crc32 = require('buffer-crc32');

exports = module.exports = session;

function session(options) {
    var options = options || {}
        , key = options.key || 'facecom.sid'
        , store = options.store || new MSSQLStore({db: {server: '144.76.74.46', userName: 'php', password: '12Kjgfnf12', options: {port: 45045, database: 'Aua.Facecom'}}, procedures: {init: 'Sec.PostSession', write: 'Sec.PostSessionData'}})
        , cookie = options.cookie || {}
        , trustProxy = options.proxy
        , storeReady = true;

    store.cookie = cookie;

    store.on('disconnect', function () {
        storeReady = false;
    });
    store.on('connect', function () {
        storeReady = true;
    });

    return function session(req, res, next) {
        // self-awareness
        if (req.session) return next();

        // Handle connection as if there is no session if
        // the store has temporarily disconnected etc
        if (!storeReady) return debug('store is disconnected'), next();

        // pathname mismatch
        if (0 != req.originalUrl.indexOf(cookie.path || '/')) return next();

        // backwards compatibility for signed cookies
        // req.secret is passed from the cookie parser middleware
        var secret = options.secret || req.secret;

        // ensure secret is available or bail
        if (!secret) throw new Error('`secret` option required for sessions');

        // parse url
        var originalHash
            , originalId;

        // expose store
        req.sessionStore = store;

        if(req.headers['x-sessionid']) {
            req.cookies[key] = decodeURIComponent(req.headers['x-sessionid']);
        }

        // grab the session cookie value and check the signature
        var rawCookie = req.cookies[key];

        // get signedCookies for backwards compat with signed cookies
        var unsignedCookie = req.signedCookies[key];

        if (!unsignedCookie && rawCookie) {
            unsignedCookie = utils.parseSignedCookie(rawCookie, secret);
        }

        // set-cookie
        res.on('header', function () {
            if (!req.session) return;
            var cookie = req.session.cookie
                , proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].toLowerCase().trim()
                , tls = req.connection.encrypted || (trustProxy && 'https' == proto)
                , isNew = unsignedCookie != req.sessionID;

            // only send secure cookies via https
            if (cookie.secure && !tls) return debug('not secured');

            // long expires, handle expiry server-side
            if (!isNew && cookie.hasLongExpires) return debug('already set cookie');

            // browser-session length cookie
            if (null == cookie.expires) {
                if (!isNew) return debug('already set browser-session cookie');
                // compare hashes and ids
            } else if (originalHash == hash(req.session) && originalId == req.session.id) {
                return debug('unmodified session');
            }
            var val = 's:' + signature.sign(req.sessionID, secret);
            val = cookie.serialize(key, val);
            debug('set-cookie %s', val);
            res.setHeader('Set-Cookie', val);
        });

        // proxy end() to commit the session
        var end = res.end;
        res.end = function (data, encoding) {
            res.end = end;
            if (!req.session) return res.end(data, encoding);
            debug('saving');
            req.session.resetMaxAge();
            req.session.save(function (err) {
                if (err) console.error(err.stack);
                debug('saved');
                res.end(data, encoding);
            });
        };

        // generate the session
        function generate(cb) {
            store.generate(req, cb);
        }

        // get the sessionID from the cookie
        req.sessionID = unsignedCookie;

        // generate a session if the browser doesn't send a sessionID
        if (!req.sessionID) {
            debug('no SID sent, generating session');
            generate(function (err) {
                err && console.error(err);
                next();
            });
            return;
        }

        // generate the session object
        var pause = utils.pause(req);
        debug('fetching %s', req.sessionID);
        store.get(req.sessionID, function (err, sid, sess) {
            // proxy to resume() events
            if (req.sessionID !== sid) {
                console.error('\x1b[31mSessionExpired\x1b[0m:',req.sessionID);
                req.sessionID = sid;
            }
            var _next = next;
            next = function (err) {
                _next(err);
                pause.resume();
            };

            // error handling
            if (err) {
                debug('error %j', err);
                if ('ENOENT' == err.code) {
                    generate(function (err) {
                        err && console.error(err);
                        next();
                    });
                } else {
                    next(err);
                }
                // no session
            } else if (!sess) {
                debug('no session found');
                generate(function (err) {
                    err && console.error(err);
                    next();
                });
                // populate req.session
            } else {
                debug('session found');
                store.createSession(req, sess);
                originalId = req.sessionID;
                originalHash = hash(sess);
                next();
            }
        });
    };
};

/**
 * Hash the given `sess` object omitting changes
 * to `.cookie`.
 *
 * @param {Object} sess
 * @return {String}
 * @api private
 */

function hash(sess) {
    return crc32.signed(JSON.stringify(sess, function (key, val) {
        if ('cookie' != key) return val;
    }));
}

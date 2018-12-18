//
// Start the server and note the logging output for requests:
//      node examples/hello-world.js | bunyan
//
// Then in a separate terminal make a few requests against it:
//      curl -i http://127.0.0.1:8000/bogus    # expect a 404
//      curl -i http://127.0.0.1:8000/hello    # expect a 200
//      curl -i http://127.0.0.1:8000/oops     # expect a 500, log at ERROR lvl
//

var tritonAuditLogger = require('../');
var bunyan = require('bunyan');
var errors = require('restify-errors');
var restify = require('restify');

var NAME = 'hello-world';
var log = bunyan.createLogger({
    name: NAME,
    serializers: restify.bunyan.serializers
});
var server = restify.createServer({
    name: NAME,
    log: log
    // ...
});

server.on(
    'after',
    tritonAuditLogger.createAuditLogHandler({
        log: log,
        resBody: {},
        routeOverrides: {
            oops: {
                logLevel: 'error'
            }
        }
    })
);

// Add some endpoints for play.
server.get('/hello', function hi(req, res, next) {
    res.send({hello: 'world'});
    next();
});
server.get({path: '/oops', name: 'oops'}, function hi(req, res, next) {
    var err = new Error('boom');
    next(new errors.InternalError(err, 'something blew up'));
});

var PORT = process.env.PORT || 8000;
var ADDR = '127.0.0.1';
server.listen(PORT, ADDR, function listening() {
    log.info('listening (http://%s:%s)', ADDR, PORT);
});

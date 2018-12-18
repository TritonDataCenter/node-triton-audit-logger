/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

'use strict'

const assert = require('assert-plus');
const bunyan = require('bunyan');
const restify = require('restify');
const restifyClients = require('restify-clients');
const restifyErrors = require('restify-errors');
const tap = require('tap');

const auditLogger = require('../..');

// ---- data

const addr = '127.0.0.1';
const port = '8123';
const url = 'http://' + addr + ':' + port;

// ---- support stuff

function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/*
 * Creates a test restify server with the given audit logger options.
 *
 * It captures its bunyan log records. Use the following to access and clear
 * the recs. `getRecs` is async to allow the restify 'after' event to fire.
 * Otherwise, after a client response, the audit logger might not yet have
 * logged.
 *
 *      server.getRecs((recs) => { ... });
 *      server.clearRecs();
 *
 * The server has a few default endpoints:
 *
 * - `GET /hello`, JSON object response, 200 status.
 * - `PUT /join`, expects JSON body with `login` field, 200 or 409 status.
 * - `GET /oops`, 500 status, JSON error body. Should log the error.
 */
function createServer(opts) {
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.auditLoggerOpts, 'opts.auditLoggerOpts');

    let auditLoggerOpts = opts.auditLoggerOpts ?
            deepCopy(opts.auditLoggerOpts) : {};
    let log;
    let recs = [];
    let server;

    log = bunyan.createLogger({
        name: opts.name,
        serializers: restify.bunyan.serializers,
        streams: [
            {
                stream: new CapturingStream(recs),
                type: 'raw'
            }
        ]
    });

    server = restify.createServer({
        name: opts.name,
        log: log
    });

    server.getRecs = function getRecs(cb) {
        // Async to allow 'after' event to be handled for audit logging.
        setImmediate(() => {
            cb(recs);
        });
    }
    server.clearRecs = function clearRecs() {
        recs.length = 0;
    }

    auditLoggerOpts.log = log;
    server.on('after', auditLogger.createAuditLogHandler(auditLoggerOpts));

    // Endpoints.
    server.get('/hello', function hello(req, res, next) {
        res.send({'hello': 'world'});
        next();
    });
    server.put('/join',
        restify.plugins.bodyParser({mapParams: false}),
        function join(req, res, next) {
            if (!req.body.login) {
                next(new restifyErrors.InvalidArgumentError(
                    'missing login field'));
            } else {
                res.send({'success': true, 'login': req.body.login});
                next();
            }
        }
    );
    server.get({path: '/oops', name: 'oops'}, function oops(req, res, next) {
        let err = new Error('this was the root cause');
        next(new restifyErrors.InternalError(err, 'something blew up'));
    });

    return server;
}

function CapturingStream(recs) {
    this.recs = recs;
}
CapturingStream.prototype.write = function (rec) {
    this.recs.push(rec);
}

// ---- tests

tap.test('empty-opts', (tt) => {
    // Default audit logger config will exclude req/res bodies.
    const auditLoggerOpts = null;

    const client = restifyClients.createJsonClient({url: url});
    const server = createServer({
        name: 'empty-opts',
        auditLoggerOpts: auditLoggerOpts
    });

    tt.test('server listen', (t) => {
        server.listen(port, addr, function listening() {
            t.end();
        });
    });

    tt.test('GET /hello', (t) => {
        server.clearRecs();
        client.get('/hello', function (err, req, res, body) {
            t.ifErr(err, err);
            t.equal(res.statusCode, 200, '200 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('PUT /join', (t) => {
        server.clearRecs();
        client.put('/join', {login: 'bob'}, function (err, req, res, body) {
            t.ifErr(err, err);
            t.equal(res.statusCode, 200, '200 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('404', (t) => {
        server.clearRecs();
        client.get('/no-such-endpoint', function (err, req, res, body) {
            t.ok(err, 'err: ' + err);
            t.equal(res.statusCode, 404, '404 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 404, 'rec.res.statusCode');
                t.equal(rec.err.name, 'ResourceNotFoundError');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('GET /oops', (t) => {
        server.clearRecs();
        client.get('/oops', function (err, req, res, body) {
            t.ok(err, 'err: ' + err);
            t.equal(res.statusCode, 500, '500 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 500, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.equal(rec.err.name, 'InternalError');
                t.equal(rec.err.message, 'something blew up');
                t.ok(/root cause/.test(rec.err.stack),
                    'err stack includes "root cause" error');
                t.end();
            });
        });
    });

    tt.test('teardown', (t) => {
        server.close();
        client.close();
        t.end();
    });

    tt.end();
});


tap.test('default-body-logging', (tt) => {
    // By default resBody/reqBody = {} will: log response bodies, excluding
    // buffers, excluding responses with GET requests with a 2xx status code,
    // and will clip at 10k characters.
    const auditLoggerOpts = {
        resBody: {},
        reqBody: {}
    };

    const client = restifyClients.createJsonClient({url: url});
    const server = createServer({
        name: 'default-body-logging',
        auditLoggerOpts: auditLoggerOpts
    });

    tt.test('server listen', (t) => {
        server.listen(port, addr, function listening() {
            t.end();
        });
    });

    tt.test('GET /hello', (t) => {
        server.clearRecs();
        client.get('/hello', function (err, req, res, body) {
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('PUT /join', (t) => {
        server.clearRecs();
        client.put('/join', {login: 'bob'}, function (err, req, res, body) {
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.equal(rec.req.body, '{"login":"bob"}');
                t.equal(rec.res.body, '{"success":true,"login":"bob"}');
                t.end();
            });
        });
    });

    tt.test('404', (t) => {
        server.clearRecs();
        client.get('/no-such-endpoint', function (err, req, res, body) {
            t.equal(res.statusCode, 404, '404 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 404, 'rec.res.statusCode');
                t.ok(rec.res.body, 'rec.res.body');
                t.end();
            });
        });
    });

    tt.test('GET /oops', (t) => {
        server.clearRecs();
        client.get('/oops', function (err, req, res, body) {
            t.equal(res.statusCode, 500, '500 status code');
            server.getRecs((recs) => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 500, 'rec.res.statusCode');
                t.ok(rec.res.body, 'rec.res.body');
                t.ok(/Internal/.test(rec.res.body),
                    '"Internal" in rec.res.body');
                t.ok(/something blew up/.test(rec.res.body),
                    '"something blew up" in rec.res.body');
                t.end();
            });
        });
    });

    tt.test('teardown', (t) => {
        server.close();
        client.close();
        t.end();
    });

    tt.end();
});

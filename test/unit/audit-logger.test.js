/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

'use strict';

const restifyClients = require('restify-clients');
const tap = require('tap');

const testcommon = require('./testcommon');

// ---- data

const addr = '127.0.0.1';
const port = '8123';
const url = 'http://' + addr + ':' + port;

// ---- tests

tap.test('empty-opts', tt => {
    // Default audit logger config will exclude req/res bodies.
    const auditLoggerOpts = null;

    const client = restifyClients.createJsonClient({url: url});
    const server = testcommon.createServer({
        name: 'empty-opts',
        auditLoggerOpts: auditLoggerOpts
    });

    tt.test('server listen', t => {
        server.listen(port, addr, function listening() {
            t.end();
        });
    });

    tt.test('GET /hello', t => {
        server.clearRecs();
        client.get('/hello', (err, _req, res, _body) => {
            t.ifErr(err, err);
            t.equal(res.statusCode, 200, '200 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('PUT /join', t => {
        server.clearRecs();
        client.put('/join', {login: 'bob'}, (err, _req, res, _body) => {
            t.ifErr(err, err);
            t.equal(res.statusCode, 200, '200 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('404', t => {
        server.clearRecs();
        client.get('/no-such-endpoint', (err, _req, res, _body) => {
            t.ok(err, 'err: ' + err);
            t.equal(res.statusCode, 404, '404 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 404, 'rec.res.statusCode');
                t.equal(rec.err.name, 'ResourceNotFoundError');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('GET /oops', t => {
        server.clearRecs();
        client.get('/oops', (err, _req, res, _body) => {
            t.ok(err, 'err: ' + err);
            t.equal(res.statusCode, 500, '500 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 500, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.equal(rec.err.name, 'InternalError');
                t.equal(rec.err.message, 'something blew up');
                t.ok(
                    /root cause/.test(rec.err.stack),
                    'err stack includes "root cause" error'
                );
                t.end();
            });
        });
    });

    tt.test('teardown', t => {
        server.close();
        client.close();
        t.end();
    });

    tt.end();
});

tap.test('default-body-logging', tt => {
    // By default resBody/reqBody = {} will: log response bodies, excluding
    // buffers, excluding responses with GET requests with a 2xx status code,
    // and will clip at 10k characters.
    const auditLoggerOpts = {
        resBody: {},
        reqBody: {}
    };

    const client = restifyClients.createJsonClient({url: url});
    const server = testcommon.createServer({
        name: 'default-body-logging',
        auditLoggerOpts: auditLoggerOpts
    });

    tt.test('server listen', t => {
        server.listen(port, addr, function listening() {
            t.end();
        });
    });

    tt.test('GET /hello', t => {
        server.clearRecs();
        client.get('/hello', (_err, _req, _res, _body) => {
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.notOk(rec.res.body, 'no rec.res.body');
                t.end();
            });
        });
    });

    tt.test('PUT /join', t => {
        server.clearRecs();
        client.put('/join', {login: 'bob'}, (_err, _req, _res, _body) => {
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 200, 'rec.res.statusCode');
                t.equal(rec.req.body, '{"login":"bob"}');
                t.equal(rec.res.body, '{"success":true,"login":"bob"}');
                t.end();
            });
        });
    });

    tt.test('404', t => {
        server.clearRecs();
        client.get('/no-such-endpoint', (_err, _req, res, _body) => {
            t.equal(res.statusCode, 404, '404 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 404, 'rec.res.statusCode');
                t.ok(rec.res.body, 'rec.res.body');
                t.end();
            });
        });
    });

    tt.test('GET /oops', t => {
        server.clearRecs();
        client.get('/oops', (_err, _req, res, _body) => {
            t.equal(res.statusCode, 500, '500 status code');
            server.getRecs(recs => {
                var rec = recs[0]; // assuming audit rec is the only one
                t.ok(rec.audit, 'rec.audit');
                t.equal(rec.res.statusCode, 500, 'rec.res.statusCode');
                t.ok(rec.res.body, 'rec.res.body');
                t.ok(
                    /Internal/.test(rec.res.body),
                    '"Internal" in rec.res.body'
                );
                t.ok(
                    /something blew up/.test(rec.res.body),
                    '"something blew up" in rec.res.body'
                );
                t.end();
            });
        });
    });

    tt.test('teardown', t => {
        server.close();
        client.close();
        t.end();
    });

    tt.end();
});

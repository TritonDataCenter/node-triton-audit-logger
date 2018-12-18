/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

'use strict';

const assert = require('assert-plus');
const bunyan = require('bunyan');
const restify = require('restify');
const restifyErrors = require('restify-errors');

const auditLogger = require('../..');

function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function CapturingStream(recs) {
    this.recs = recs;
}
CapturingStream.prototype.write = function write(rec) {
    this.recs.push(rec);
};

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

    let auditLoggerOpts = opts.auditLoggerOpts
        ? deepCopy(opts.auditLoggerOpts)
        : {};
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
    };
    server.clearRecs = function clearRecs() {
        recs.length = 0;
    };

    auditLoggerOpts.log = log;
    server.on('after', auditLogger.createAuditLogHandler(auditLoggerOpts));

    // Endpoints.
    server.get('/hello', function hello(req, res, next) {
        res.send({hello: 'world'});
        next();
    });
    server.put(
        '/join',
        restify.plugins.bodyParser({mapParams: false}),
        function join(req, res, next) {
            if (!req.body.login) {
                next(
                    new restifyErrors.InvalidArgumentError(
                        'missing login field'
                    )
                );
            } else {
                res.send({success: true, login: req.body.login});
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

module.exports = {
    createServer: createServer
};

# triton-audit-logger

This package is an adaptation of the [restify audit logging
plugin](https://github.com/restify/node-restify/blob/master/lib/plugins/audit.js)
for use in Triton APIs. It adds a few features to the restify audit logger.
See the [top comment in lib/audit-logger.js](./lib/audit-logger.js) for
details. (This started with the restify v4 audit logger, so it is possible that
current restify versions do some of the same things.)

(This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.)


## Usage

Reasonably minimal usage (see [examples/hello-world.js](./examples/hello-world.js)):

```javascript
var auditLogger = require('audit-logger');
var bunyan = require('bunyan');
var restify = require('restify');

var NAME = 'hello-world';
var log = bunyan.createLogger({
    name: NAME,
    serializers: restify.bunyan.serializers
});
var server = restify.createServer({
    name: NAME,
    log: log,
    // ...
});

server.on('after', auditLogger.createAuditLogHandler({
    log: log,
    // ...
}));
```

An example showing some configuration:


```javascript
server.on('after', auditLogger.createAuditLogHandler({
    log: log,
    reqBody: {
        include: true,
        maxLen: 1024
    },
    resBody: {
        // Log the response body, but not for 200-299 HTTP status response.
        include: true,
        includeGet2xx: false
    },
    routeOverrides: {
        // Never log 'ping' route requests.
        'getping': {include: false},

        // Reduce logging for a possibly frequent restify route at a
        // different level that isn't typically enabled.
        'getconfigs': {
            logLevel: 'debug'
        }
    },
    polish: function censorAuth(fields, req, res, route, err) {
        // Censor potential auth info in a particular header.
        if (req.headers['x-registry-auth'] !== undefined) {
            req.headers['x-registry-auth'] = '(censored)';
        }
    }
}));
```


## Development

### Commiting

Before commit, ensure that the following passes:

    make fmt check

You can setup a local git pre-commit hook that'll do that by running

    make git-hooks

Also see the note at the top that https://cr.joyent.us is used for code review
for this repo.


### Releasing

Changes with possible user impact should:

1. Add a note to the [changelog](./CHANGES.md).
2. Bump the package version appropriately (major for breaking changes, minor
   for new features, patch for bug fixes).
3. Once merged to master, the new version should be tagged and published to npm
   via:

        make cutarelease

   To list to npm accounts that have publish access:

        npm owner ls $packageName

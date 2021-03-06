'use strict';
var express = require('express');
var expressWs = require('express-ws');
var bodyParser = require('body-parser');
var compression = require('compression');
var cors = require('cors');
var jobs = require('./job-handlers');
var paths = require('./path-handlers');
var prepares = require('./prepare-handlers');
var logger = require('log4js').getLogger('juttle-express-router');
var getVersionInfo = require('./version').getVersionInfo;

var JuttleServiceErrors = require('./errors');

var API_PREFIX = '/api/v0';

function default_error_handler(err, req, res, next) {
    logger.debug('got error "' + err.message + '"');

    // Errors from bodyParser.json() might appear here. Transform
    // them into the error formats we expect.
    if (err.message.startsWith('Unexpected token')) {
        err = JuttleServiceErrors.bundleError(err.message, err.body);
    } else if (! JuttleServiceErrors.is_juttle_service_error(err)) {
        // This error isn't one of the standard errors in
        // JuttleServiceErrors. Wrap the error in an UnknownError.
        err = JuttleServiceErrors.unknownError({
            name: err.name,
            message: err.message,
            stack: err.stack
        });
    }

    res.status(err.status()).send(err);
}

function add_routes(app, config, config_path) {

    jobs.init(config, config_path);
    paths.init(config);

    // Create an express router to handle all the non-websocket
    // routes.
    let router = express.Router();

    if (config.compress_response) {
        router.use(compression());
    }

    // allow requests from all browser origins
    router.use(cors());

    router.get('/jobs',
               jobs.list_all_jobs);
    router.get('/jobs/:job_id',
               jobs.list_job);
    router.delete('/jobs/:job_id',
                  jobs.delete_job);
    router.post('/jobs',
                bodyParser.json(), jobs.create_job);
    router.get('/observers/',
               jobs.list_observers);

    router.get('/paths/*',
               bodyParser.json(), paths.get_path);
    router.get('/directory',
               bodyParser.json(), paths.get_dir);

    router.post('/prepare',
                bodyParser.json(), prepares.get_inputs);

    router.get('/version-info', (req, res) => {
        res.send(getVersionInfo());
    });

    router.get('/config-info', (req, res) => {
        res.send(config);
    });

    router.use(default_error_handler);

    app.use(API_PREFIX, router);

    // For the websocket routes, we need to add them directly to the
    // app, as the package we use (express-ws) doesn't support adding
    // websocket-based paths to routers (see
    // https://github.com/HenningM/express-ws/issues/8).

    if (! app.ws) {
        expressWs(app);
    }

    app.ws(API_PREFIX + '/jobs/:job_id',
              jobs.subscribe_job);
    app.ws(API_PREFIX + '/observers/:observer_id',
              jobs.subscribe_observer);

    return router;
}

module.exports = add_routes;

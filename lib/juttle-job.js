'use strict';

var _ = require('underscore');
var JSDP = require('juttle-jsdp');
var JSDPValueConverter = require('./jsdp-value-converter');
var child_process = require('child_process');
var Promise = require('bluebird');
var JuttleServiceErrors = require('./errors');
var logger = require('log4js').getLogger('juttle-job');
var EventEmitter = require('events');

// This class handles the details of running a program from a
// bundle, handling an explicit stop from a job manager, emitting the
// proper events when the job has completed, etc.
//
// Actually passing the results of programs back to websocket and/or
// http clients is handled by subclasses. Based on the method, the Job
// Manager will create an object of one of the subclasses.

class JuttleJob {
    constructor(options) {
        var self = this;

        self._job_id = options.job_id;
        self.events = new EventEmitter();

        self._bundle = options.bundle;
        self._inputs = options.inputs;
        self._debug = options.debug;
        self._config_path = options.config_path;

        // A handle to the spawned child process where the juttle
        // program is actually run.
        self._child = undefined;

        self._log_prefix = '(job=' + self._job_id + ') ';

        self._received_program_started = false;
        self._job_stopped = false;

        logger.debug(self._log_prefix + 'Created job');
    }

    describe() {
        var self = this;

        return {
            job_id: self._job_id,
            bundle: self._bundle
        };
    }

    start() {
        var self = this;

        logger.debug(self._log_prefix + 'Starting job');

        // We run the juttle program in a subprocess. Note that the
        // only argument to the subprocess is the value of the
        // --config file (if defined).
        var args = [];
        if (self._config_path) {
            args.push(self._config_path);
        }

        self._child = child_process.fork(__dirname + '/juttle-subprocess.js', args, {silent: true});

        self._child.on('message', function(msg) {
            //logger.debug("Got message from child", msg);
            switch (msg.type) {
                case 'data':
                    var send_data = _.extend(msg.data, {job_id: self._job_id});
                    self._on_job_msg(send_data);
                    break;
                case 'log':
                    var processLogger = require('log4js').getLogger(msg.name);
                    processLogger[msg.level].apply(processLogger, JSDP.deserialize(msg.arguments));
                    if (self._debug) {
                        self._on_job_msg(msg);
                    }
                    break;
                case 'done':
                    logger.info('subprocess done');
                    self._child.send({cmd: 'stop'});
                    break;
                case 'warning':
                case 'error':
                    self._on_job_msg(msg);
                    break;
            }
        });

        self._child.on('close', function(code, signal) {
            logger.debug('subprocess exit', code, signal);
            if (code !== 0) {
                logger.error('Subprocess exited unexpectedly with code=' + code);
            } else {
                logger.debug('Subprocess exited with code=' + code);
            }

            // Set _child to undefined now, so nothing can send it a
            // message any longer.
            self._child = undefined;

            self._on_job_msg({
                type: 'job_end',
                job_id: self._job_id
            });

            self._job_stopped = true;

            // This is a signal that the job has ended, including a
            // signal to subclasses.
            self.events.emit('end');
        });

        self._child.on('error', function(err) {
            logger.error('Received error ' + err + ' from subprocess');
        });

        self._child.stderr.setEncoding('utf8');
        self._child.stderr.on('data', function(err) {
            logger.error('child-process-error', err);
        });

        // Return a promise that resolves when we've received a
        // program_started message from the child, and rejects when we
        // receive a compile_error message from the child.

        var child_started = new Promise(function(resolve, reject) {
            self._child.on('message', function(msg) {
                //logger.debug("Got message from child", msg);

                switch (msg.type) {
                    case 'program_started':
                        self._received_program_started = true;
                        self._on_job_msg({type: 'job_start',
                                              job_id: self._job_id,
                                              views: msg.views,
                                              juttleEnv: msg.juttleEnv});
                        resolve({job_id: self._job_id, pid: self._child.pid});
                        break;
                    case 'juttle_error':
                        reject(new JuttleServiceErrors.juttleError(msg.err, self._bundle));
                        break;
                    case 'internal_error':
                        reject(new JuttleServiceErrors.unknownError(msg.err, self._bundle));
                        break;
                }
            });
        });

        // Send the program to the child
        self._child.send({cmd: 'run', bundle: self._bundle, inputs: JSDP.serialize(JSDPValueConverter.convertToJSDPValue(self._inputs), { toObject: true })});

        return child_started;
    }

    stop() {
        var self = this;

        logger.debug(self._log_prefix + 'Stopping job');

        // Stop the subprocess by sending it a stop message. That will
        // cause the child to emit a 'close' event. The handler for
        // close will clean everything up.
        if (self._child) {
            self._child.send({cmd: 'stop'});
        }
    }

    // Send a message to whoever is listening to the output of this
    // job. This method should be overridden by subclasses.
    _on_job_msg(msg) {
    }
}

module.exports = JuttleJob;

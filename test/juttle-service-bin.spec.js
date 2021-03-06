'use strict';
var path = require('path');
var expect = require('chai').expect;
var child_process = require('child_process');
var Promise = require('bluebird');
var findFreePort = Promise.promisify(require('find-free-port'));
var service = require('../lib/juttle-service');

let juttle_service_cmd = path.resolve(`${__dirname}/../bin/juttle-service`);
let juttle_service_client_cmd = path.resolve(`${__dirname}/../bin/juttle-service-client`);

describe('juttle-service-client binary', function() {

    let server;
    let juttle_service;

    before(function() {
        findFreePort(10000, 20000)
        .then((freePort) => {
            server = 'localhost:' + freePort;
            juttle_service = service.run({port: freePort, root: __dirname});
        });
    });

    after(function() {
        juttle_service.stop();
    });

    it('can be run with --help', function() {
        var ret = child_process.spawnSync(juttle_service_client_cmd, ['--help']);
        // The status is 1, but we can also check the output for 'usage:'
        expect(ret.status).to.equal(1);
        expect(ret.stdout.toString()).to.match(/^usage: /);
    });

    it('can be run with list_jobs', function(done) {

        let got_output = false;

        // Can't use spawnSync here, as the server is running within
        // our own process, and spawnSync blocks the event loop.
        let child = child_process.spawn(juttle_service_client_cmd, ['--juttle-service', server,  'list_jobs']);

        child.stdout.on('data', (data) => {
            if (data.toString().match(/\[\]/)) {
                got_output = true;
            }
        });

        child.on('close', (code) => {
            expect(code).to.equal(0);
            expect(got_output).to.equal(true);
            done();
        });
    });

});


describe('juttle-service binary', function() {

    it('can be run with --help', function() {
        var ret = child_process.spawnSync(juttle_service_cmd, ['--help']);
        // The status is 1, but we can also check the output for 'usage:'
        expect(ret.status).to.equal(1);
        expect(ret.stdout.toString()).to.match(/^usage: /);
    });

    it('Returns usage() when run with non-option arguments', function() {
        var ret = child_process.spawnSync(juttle_service_cmd, ['foo']);
        // The status is 1, but we can also check the output for 'usage:'
        expect(ret.status).to.equal(1);
        expect(ret.stdout.toString()).to.match(/^usage: /);
    });

    it('can be run and can see startup line', function(done) {
        var got_output = false;
        findFreePort(10000, 20000)
        .then((freePort) => {
            let child = child_process.spawn(juttle_service_cmd, ['--port', freePort]);
            child.stdout.on('data', (data) => {
                if (data.toString().match(/Juttle service listening at/)) {
                    got_output = true;
                    child.kill('SIGKILL');
                }
            });
            child.on('close', (code) => {
                expect(got_output).to.equal(true);
                done();
            });
            child.on('error', (msg) => {
                throw new Error(`Got unexpected error from child: ${msg}`);
            });
        });
    });
});

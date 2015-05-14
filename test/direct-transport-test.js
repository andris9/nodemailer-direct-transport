'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var directTransport = require('../src/direct-transport');
var SMTPServer = require('smtp-server').SMTPServer;
chai.config.includeStack = true;

var PORT_NUMBER = 8712;
var MockBuilder = require('./mocks/mock-builder');

describe('SMTP Transport Tests', function() {
    this.timeout(100 * 1000);

    var server;
    var retryCount = 0;

    beforeEach(function(done) {
        server = new SMTPServer({
            disabledCommands: ['STARTTLS', 'AUTH'],

            onData: function(stream, session, callback) {
                stream.on('data', function() {});
                stream.on('end', function() {
                    var err;
                    if (/retry@/.test(session.envelope.mailFrom.address) && retryCount++ < 3) {
                        err = new Error('Please try again later');
                        err.responseCode = 451;
                        callback(err);
                    } else {
                        callback(null, 'OK');
                    }
                });
            },

            onMailFrom: function(address, session, callback) {
                if (/invalid@/.test(address.address)) {
                    return callback(new Error('Invalid sender'));
                }
                return callback(); // Accept the address
            },
            onRcptTo: function(address, session, callback) {
                if (/invalid@/.test(address.address)) {
                    return callback(new Error('Invalid recipient'));
                }
                return callback(); // Accept the address
            },
            logger: false
        });

        server.listen(PORT_NUMBER, done);
    });

    afterEach(function(done) {
        server.close(done);
    });

    it('Should expose version number', function() {
        var client = directTransport();
        expect(client.name).to.exist;
        expect(client.version).to.exist;
    });

    it('Should send mail', function(done) {
        var client = directTransport({
            port: PORT_NUMBER,
            debug: false
        });

        client.on('log', console.log);

        var chunks = [],
            message = new Array(1024).join('teretere, vana kere\n');

        server.on('data', function(connection, chunk) {
            chunks.push(chunk);
        });

        server.on('dataReady', function(connection, callback) {
            var body = Buffer.concat(chunks);
            expect(body.toString()).to.equal(message.trim().replace(/\n/g, '\r\n'));
            callback(null, true);
        });

        client.send({
            data: {},
            message: new MockBuilder({
                from: 'test@[127.0.0.1]',
                to: 'test@[127.0.0.1]'
            }, message)
        }, function(err, info) {
            expect(err).to.not.exist;
            expect(info.accepted).to.deep.equal(['test@[127.0.0.1]']);
            done();
        });
    });

    it('Should retry mail', function(done) {
        var client = directTransport({
            port: PORT_NUMBER,
            debug: false,
            retryDelay: 1000
        });

        client.on('log', console.log);

        client.send({
            data: {},
            message: new MockBuilder({
                from: 'retry@[127.0.0.1]',
                to: ['test@[127.0.0.1]', 'test2@[127.0.0.1]']
            }, 'test')
        }, function(err, info) {
            expect(err).to.not.exist;
            expect(info.pending.length).to.equal(1);
            done();
        });
    });

    it('Should reject mail', function(done) {
        var client = directTransport({
            port: PORT_NUMBER,
            debug: false,
            retryDelay: 1000
        });

        client.on('log', console.log);

        client.send({
            data: {},
            message: new MockBuilder({
                from: 'invalid@[127.0.0.1]',
                to: ['test@[127.0.0.1]', 'test2@[127.0.0.1]']
            }, 'test')
        }, function(err) {
            expect(err).to.exist;
            expect(err.errors[0].recipients).to.deep.equal(['test@[127.0.0.1]', 'test2@[127.0.0.1]']);
            done();
        });
    });

    it('should proxy error events triggered by the message stream', function(done) {
        var client = directTransport({
            port: PORT_NUMBER,
            debug: false,
            retryDelay: 1000
        });
        var streamError = new Error('stream read error');
        var messageString = 'test';
        var message = new MockBuilder({
            from: 'test@[127.0.0.1]',
            to: ['test@[127.0.0.1]']
        }, messageString, streamError);

        var errorSpy = sinon.spy();
        client.on('error', errorSpy);

        client.send({
            data: {},
            message: message
        }, function(err) {
            expect(err).to.not.exist;
            expect(errorSpy.callCount).to.equal(1);
            done();
        });
    });
});
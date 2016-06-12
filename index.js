'use strict';
var util = require('gulp-util');
var path = require('path');
var PluginError = require('gulp-util').PluginError;
var chokidar = require('chokidar');
var Duplex = require('readable-stream').Duplex;
var vinyl = require('vinyl-file');
var File = require('vinyl');
var anymatch = require('anymatch');
var pathIsAbsolute = require('path-is-absolute');
var glob2base = require('glob2base');
var Glob = require('glob').Glob;

function normalizeGlobs(globs) {
	if (!globs) {
		throw new PluginError('gulp-watch', 'glob argument required');
	}

	if (typeof globs === 'string') {
		globs = [globs];
	}

	if (!Array.isArray(globs)) {
		throw new PluginError('gulp-watch', 'glob should be String or Array, not ' + (typeof globs));
	}

	return globs;
}

module.exports = function (globs, opts, cb) {
	globs = normalizeGlobs(globs);

	if (typeof opts === 'function') {
		cb = opts;
		opts = {};
	}

	opts = opts || {};
	cb = cb || function () {};

	function resolveGlob(glob) {
		var mod = '';
		var resolveFn = path.resolve;

		if (glob[0] === '!') {
			mod = glob[0];
			glob = glob.slice(1);
		}

		if (opts.cwd) {
			resolveFn = path.normalize;
		}

		return mod + resolveFn(glob);
	}
	globs = globs.map(resolveGlob);

	opts.events = opts.events || ['add', 'change', 'unlink'];

	if (opts.ignoreInitial === undefined) {
		opts.ignoreInitial = true;
	}

	opts.readDelay = opts.readDelay || 10;

	var baseForced = Boolean(opts.base);
	var outputStream = new Duplex({objectMode: true, allowHalfOpen: true});

	outputStream._write = function _write(file, enc, done) {
		cb(file);
		this.push(file);
		done();
	};

	outputStream._read = function _read() { };

	var watcher = chokidar.watch(globs, opts);

	opts.events.forEach(function (ev) {
		watcher.on(ev, processEvent.bind(undefined, ev));
	});

	['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'error', 'ready', 'raw']
		.forEach(function (ev) {
			watcher.on(ev, outputStream.emit.bind(outputStream, ev));
		});

	outputStream.add = function add(newGlobs) {
		newGlobs = normalizeGlobs(newGlobs)
			.map(resolveGlob);
		watcher.add(newGlobs);
		globs.push.apply(globs, newGlobs);
	};
	outputStream.unwatch = watcher.unwatch.bind(watcher);
	outputStream.close = function () {
		watcher.close();
		this.emit('end');
	};

	function processEvent(event, filepath) {
		var glob;
		var currentFilepath = filepath;
		while (!(glob = globs[anymatch(globs, currentFilepath, true)]) && currentFilepath !== (currentFilepath = path.resolve(currentFilepath, '..'))) {} // eslint-disable-line no-empty-blocks/no-empty-blocks

		if (!glob) {
			util.log(
				util.colors.cyan('[gulp-watch]'),
				util.colors.yellow('wut? This shouldn\'t happen. Please open this link to report the issue:\n') +
				'https://github.com/floatdrop/gulp-watch/issues/new?title=' +
				encodeURIComponent('Watched unexpected filepath') + '&body=' +
				encodeURIComponent('Globs: `' + JSON.stringify(globs) + '`\nFilepath: `' + filepath + '`\nOptions:\n```js\n' + JSON.stringify(opts, null, 2) + '\n```')
			);
			return;
		}

		if (!baseForced) {
			opts.base = glob2base(new Glob(glob));
		}

		// Do not stat deleted files
		if (event === 'unlink' || event === 'unlinkDir') {
			opts.path = pathIsAbsolute(filepath) ? filepath : path.join(opts.cwd || process.cwd(), filepath);

			write(event, null, new File(opts));
			return;
		}

		// Workaround for early read
		setTimeout(function () {
			vinyl.read(filepath, opts, write.bind(null, event));
		}, opts.readDelay);
	}

	function write(event, err, file) {
		if (err) {
			outputStream.emit('error', err);
			return;
		}

		if (opts.verbose) {
			log(event, file);
		}

		file.event = event;
		outputStream.push(file);
		cb(file);
	}

	function log(event, file) {
		event = event[event.length - 1] === 'e' ? event + 'd' : event + 'ed';

		var msg = [util.colors.magenta(file.relative), 'was', event];

		if (opts.name) {
			msg.unshift(util.colors.cyan(opts.name) + ' saw');
		}

		util.log.apply(util, msg);
	}

	return outputStream;
};


const PATH = require("path");
const FS = require("fs");
const SPAWN = require("child_process").spawn;


exports.for = function(API, plugin) {

    plugin.resolveLocator = function(locator, options, callback) {
        var self = this;

        if (!locator.version && !locator.selector && locator.descriptor.pointer) {
            var m;
            if((m = locator.descriptor.pointer.match(/registry.npmjs.org\/([^\/]*)\/-\/(.*)$/))) {
                locator.pm = "npm";
                locator.vendor = "npm";
                locator.id = m[1];
                if (m[2].substring(0, m[1].length+1) === (m[1] + "-")) {
                    if((m = m[2].substring(m[1].length+1).match(/^(.*)\.tgz$/))) {
                        locator.version = m[1];
                    }
                }
            }
        }

        locator.getLocation = function(type) {
            var locations = {
                "status": "https://registry.npmjs.org/" + this.id,
                // Without reading the descriptor this is as close as we can get to the homepage.
                "homepage": "https://registry.npmjs.org/" + this.id
            };
            if (this.version) {
                locations.tar = "http://registry.npmjs.org/" + this.id + "/-/" + this.id + "-" + this.version + ".tgz";
                locations.pointer = locations.tar;
            }
            return (type)?locations[type]:locations;
        }

        return callback(null, locator);
    }

	plugin.status = function(options) {
		if (!plugin.node.exists || !plugin.node.descriptors.package) return API.Q.resolve(false);
		var status = {};
        // Contains `<name>@<version>` of installed.
        if (typeof plugin.node.descriptors.package._id !== "undefined") {
        	status.version = plugin.node.descriptors.package._id.replace(/^[^@]*@/,"");
        }
        // Contains `<name>@<selector>` from dependency declaration.
        if (typeof plugin.node.descriptors.package._from !== "undefined") {
        	status.pointer = plugin.node.descriptors.package._from.replace(/^[^@]*@/,"");
        }
        return API.Q.resolve(status);
	}

	plugin.latest = function(options) {
        var self = this;
        if (
            !self.node.name ||
            !self.node.summary.declaredLocator ||
            self.node.summary.declaredLocator.descriptor.pm !== "npm"
        ) return API.Q.resolve(false);

        var uri = self.node.summary.declaredLocator.getLocation("status");
        if (!uri) return API.Q.resolve(false);

        var opts = API.UTIL.copy(options);
        opts.loadBody = true;
        opts.ttl = API.HELPERS.ttlForOptions(options);
        function fetch(options, callback) {
            return self.fetchExternalUri(uri, options, function(err, response) {
                if (err) return callback(err);
                var summary = {};
                if (response.status === 200 || response.status === 304) {
                    summary.published = true;
                    summary.descriptor = JSON.parse(response.body.toString());
                    summary.version = summary.descriptor["dist-tags"].latest
                    // TODO: Populate only with relevant data (according to PINF standard).
                    summary.versions = summary.descriptor.versions || {};
    /*
                    var versionSelector = options.versionSelector;
                    summary.published = true;
                    summary.actualVersion = pm.context.package.descriptor.json.version;
                    summary.latestVersion = descriptor["dist-tags"].latest;
                    summary.usingLatest = (SEMVER.compare(summary.actualVersion, summary.latestVersion)===0)?true:false;
                    summary.versions = Object.keys(descriptor.versions);
                    if (versionSelector) {
                        summary.versionSelector = versionSelector;
                        summary.latestSatisfyingVersion = SEMVER.maxSatisfying(summary.versions, versionSelector) || false;
                        summary.usingLatestSatisfying = (SEMVER.compare(summary.actualVersion, summary.latestSatisfyingVersion)===0)?true:false;
                    }
                    if (descriptor.time) {
                        if (summary.actualVersion && descriptor.time[summary.actualVersion]) {
                            summary.actualVersionTime = descriptor.time[summary.actualVersion];
                            summary.actualVersionAge = Math.floor((new Date().getTime() - new Date(summary.actualVersionTime).getTime())/1000/60/60/24);
                        }
                        if (summary.latestVersion && descriptor.time[summary.latestVersion]) {
                            summary.latestVersionTime = descriptor.time[summary.latestVersion];
                            summary.latestVersionAge = Math.floor((new Date().getTime() - new Date(summary.latestVersionTime).getTime())/1000/60/60/24);
                        }
                    }
                    if (options.includeDescriptor === true) {
                        summary.descriptor = descriptor;
                    }
    */
                } else
                if (response.status === 404) {
                    summary.published = false;
                } else {
                    return callback(new Error("Got response status '" + response.status + "' for '" + uri + "'!"));
                }
                return callback(null, [response, summary]);
            });
        }

        var deferred = API.Q.defer();
        fetch(opts, function(err, response) {
            if (err) return deferred.reject(err);
            // If installed version is newer than latest, re-fetch with today as TTL.
            // TODO: Verify that this works!
            if (
                self.node.exists &&
                response[0].status === 304 &&
                self.node.summary.actualLocator &&
                self.node.summary.actualLocator.version &&
                API.SEMVER.compare(self.node.summary.actualLocator.version, response[1].version) > 0
            ) {
                opts.ttl = API.HELPERS.ttlForOptions(options, "today");
                return fetch(opts, function(err, response) {
                    if (err) return deferred.reject(err);
                    return deferred.resolve(response[1]);
                });
            }
            return deferred.resolve(response[1]);
        });
        return deferred.promise;
	}

    plugin.install = function(packagePath, options) {
        var args = [
            "install",
            ".",
            "--production"
        ];
        return callNPM(packagePath, args, options);
    }

    plugin.publish = function(options) {
        var self = this;
        var opts = API.UTIL.copy(options);
        opts.cwd = self.node.path;
        var args = [
            "publish"
        ];
        if (self.node.summary.versionStream) {
            args.push("--tag", self.node.summary.versionStream);
        }
        return API.OS.spawnInline("npm", args, opts);
    }

    plugin.test = function(node, options) {
        if (!node.descriptor.package.scripts || !node.descriptor.package.scripts.test) {
            API.TERM.stdout.writenl("\0yellow(No `scripts.test` property found in package descriptor for package '" + node.path + "'.\0)");
            return API.Q.resolve();
        }
        var args = [
            "test",
        ];
        if (options.cover) {
            args.push("--cover");
            // TODO: Call test differently to enable test coverage via istanbul even if package
            //       does not support test coverage out of the box. This will work if test script points
            //       to a JS file.
        }
        return callNPM(node.path, args, options);
    }


    function callNPM(basePath, args, options) {

        options = options || {};

        var deferred = API.Q.defer();

        if (options.verbose) {
            API.TERM.stdout.writenl("\0cyan(Running: npm " + args.join(" ") + " (cwd: " + basePath + ")\0)");
        }

        var opts = {
            cwd: basePath
        };
        if (options.env) {
            opts.env = UTIL.copy(process.env);
            for (var key in options.env) {
                opts.env[key] = options.env[key];
            }
        }

        var proc = SPAWN("npm", args, opts);
        var buffer = "";

        proc.on("error", function(err) {
            deferred.reject(err);
        });

        proc.stdout.on("data", function(data) {
            if (options.verbose) {
                API.TERM.stdout.write(data.toString());
            }
            buffer += data.toString();
        });
        proc.stderr.on("data", function(data) {
            if (options.verbose) {
                API.TERM.stderr.write(data.toString());
            }
            buffer += data.toString();
        });
        proc.on("exit", function(code) {
            if (code !== 0) {
                API.TERM.stdout.writenl("\0red(" + buffer + "\0)");
                deferred.reject(new Error("NPM error"));
                return;
            }
            if (/npm ERR!/.test(buffer)) {
                
                // WORKAROUND: NPM sometimes gives this error but all seems to be ok.
                if (/cb\(\) never called!/.test()) {

                    TERM.stdout.writenl("\0red(IGNORING NPM EXIT > 0 AND HOPING ALL OK!\0)");

                } else {

                    deferred.reject(new Error("NPM error: " + buffer));
                    return;
                }
            }
            deferred.resolve();
        });

        return deferred.promise;
    }
}


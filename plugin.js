

exports.for = function(API, plugin) {

    plugin.resolveLocator = function(locator, options) {
        var self = this;

        locator.getLocation = function(type) {
            var locations = {
                "status": "https://registry.npmjs.org/" + this.id
            };
            return (type)?locations[type]:locations;
        }

        return self.API.Q.resolve(locator);
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
        function fetch(options) {
            return self.fetchExternalUri(uri, options).then(function(response) {
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
                    throw new Error("Got response status '" + response.status + "' for '" + uri + "'!");
                }
                return [response, summary];
            });
        }
        return fetch(opts).then(function(response) {
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
                return fetch(opts).then(function(response) {
                    return response[1];
                });
            }
            return response[1];
        });
	}
}


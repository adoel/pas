var provider = require('./provider'),
    semver = require('semver'),
    path = require('path'),
    config = require('./config')(),
    url = require('url'),
    mkdirp = require('./fsutil').mkdirp,
    profile = require('./profile'),
    Package = require('./pkg'),
    fs = require('fs');

var queryCache = {};

var Query = function(queryUrl) {
    'use strict';

    this.queryUrl = queryUrl;
    this.queryWorkingPackage = false;

    if (!queryUrl) {
        this.queryWorkingPackage = true;

        var prof = profile.detect({
            name: queryUrl,
            baseDir: config.cwd
        });

        var manifestFile = path.join(config.cwd, 'pas.json');
        if (fs.existsSync(manifestFile)) {
            var manifest = require(manifestFile);
            queryUrl = 'local:' + manifest.name + '#master';
        } else {
            queryUrl = 'local:';
        }
    }

    Object.defineProperties(this, {
        provider: {
            enumerable: false,
            writable: true,
            value: provider.detect(queryUrl),
        }
    });

    var data = this.provider.parse(queryUrl);
    for(var i in data) {
        this[i] = data[i];
    }

    this.indices = {};
};

Query.prototype.initialize = function() {
    'use strict';

    if (this.queryWorkingPackage) {
        return Promise.resolve();
    }

    var indexFile = path.join(config.providerHome, this.provider.name, this.name, 'indices.json');

    return new Promise(function(resolve, reject) {
            fs.exists(indexFile, function(exists) {
                resolve(exists);
            });
        }.bind(this))
        .then(function(exists) {
            if (exists) {
                return require(indexFile);
            } else {
                return this.provider.fetchIndices(this.vendor, this.unit);
            }
        }.bind(this))
        .then(function(indices) {
            this.indices = indices;
            mkdirp(path.join(indexFile, '..'));
            fs.writeFileSync(indexFile, JSON.stringify(this.indices, null, 4));
        }.bind(this));
};

Query.prototype.get = function() {
    'use strict';

    var validVersion;

    if (this.queryWorkingPackage && this.version === 'master') {
        validVersion = this.version;
    } else if (semver.validRange(this.version)) {
        var versions = Object.keys(this.indices.releases || {});

        validVersion = semver.maxSatisfying(versions, this.version);
        if (!validVersion) {
            validVersion = 'master';
        }
    } else if (this.indices.devs[this.version]) {
        validVersion = this.version;
    } else {
        throw new Error('Bad version ' + this.url);
    }

    return new Package({
        query: this,
        url: this.provider.normalizeUrl(this.name + '#' + validVersion),
        name: this.name,
        version: validVersion,
        baseDir: this.queryWorkingPackage ?
            config.cwd :
            path.join(config.providerHome, this.provider.name, this.name, validVersion),
        isWorkingPackage: this.queryWorkingPackage
    });
};

var query = function(queryUrl) {
    'use strict';

    queryUrl = queryUrl || '';

    if (!queryCache[queryUrl]) {
        var q = queryCache[queryUrl] = new Query(queryUrl);
        return q.initialize()
            .then(function() {
                return q;
            });
    } else {
        return Promise.resolve(queryCache[queryUrl]);
    }
};

query.profile = profile;

module.exports = query;

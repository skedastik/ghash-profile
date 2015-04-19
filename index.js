// compare hashing results under various attacks and resolutions

var hd = require('hamming-distance');
var sprintf = require('sprintf-js').sprintf;
var Promise = require('bluebird');
var ghash = require('ghash');
var fs = require('fs');

// set to true to include attacks against which ghash has little to no resilience:
var unfair = false;
// set to true to tell ghash to output preprocessed images
var debugOut = false;

var BASE_PATH = 'sample/';
var ORIGINALS_PATH = 'originals/';
var ATTACKS_PATH = 'attacks/';
var ATTACKS_EXTRA_PATH = 'attacks-extra/';

var attacks = fs.readdirSync(BASE_PATH + ATTACKS_PATH)
.filter(function (filename) {
    return /^[^\.]/.test(filename);
});
var attacksExtra = fs.readdirSync(BASE_PATH + ATTACKS_EXTRA_PATH)
.filter(function (filename) {
    return /^[^\.]/.test(filename);
});

if (unfair) {
    attacks = attacks.concat(attacksExtra);
}

var files = fs.readdirSync(BASE_PATH + ORIGINALS_PATH)
.filter(function (filename) {
    return /\.jpg$/.test(filename);
});

var fuzzinesses = [0, 5, 10];
var resolutions = [8, 4, 3];

var hashesOriginal = Promise.map(fuzzinesses, function(fuzziness, idx) {
    return Promise.map(resolutions, function(resolution) {
        return Promise.map(files, function(filename) {
            var hash = ghash(BASE_PATH + ORIGINALS_PATH + filename);
            if (debugOut && idx == 0) hash.debugOut('var/' + filename.match(/(.+)\.jpg$/)[1] + '-res' + resolution);
            return hash.resolution(resolution)
            .fuzziness(fuzziness)
            .calculate();
        });
    });
});

var hashesAttacked = Promise.map(fuzzinesses, function(fuzziness, idx) {
    return Promise.map(resolutions, function(resolution) {
        return Promise.map(files, function(filename) {
            return Promise.map(attacks, function(attack) {
                var hash = ghash(BASE_PATH + ATTACKS_PATH + attack + '/' + filename);
                if (debugOut && idx == 0) hash.debugOut('var/' + filename.match(/(.+)\.jpg$/)[1] + '-res' + resolution + ' ' + attack);
                return hash.resolution(resolution)
                .fuzziness(fuzziness)
                .calculate();
            });
        });
    });
});

console.log('Computing Hamming distances of first input image (' + files[0] + ') to all other inputs--originals only.');
console.log('This will take a few seconds...\n');
Promise.all(hashesOriginal).then(compareOriginals)
.then(function() {
    console.log('Computing Hamming distances of original input images to various attacked versions.');
    console.log('This will take a minute or two...\n');
    Promise.all(hashesAttacked).then(compareAttacked);
});

function compareOriginals(hashSets) {
    for (var j = 0; j < fuzzinesses.length; j++) {
        var collisionCounts = [-1, -1, -1];
        console.log('    fuzziness = ' + fuzzinesses[j] + '\n');
        console.log(sprintf('        %-40s %-7s %-7s %-7s', 'Input', 'res=8', 'res=4', 'res=3'));
        console.log(sprintf('        --------------------------------------------------------------'));
        for (var i = 0; i < files.length; i++) {
            var distances = [
                hd(hashSets[j][0][0], hashSets[j][0][i]),
                hd(hashSets[j][1][0], hashSets[j][1][i]),
                hd(hashSets[j][2][0], hashSets[j][2][i])
            ];
            var hdStrings = computeDistanceStrings(distances, i);
            console.log(sprintf('        %-40s %-7s %-7s %-7s',
                files[i],
                hdStrings[0],
                hdStrings[1],
                hdStrings[2]
            ));
            distances.forEach(function (distance, idx) {
                if (distance == 0) collisionCounts[idx]++;
            });
        }
        var totalComparisons = files.length - 1;
        console.log(sprintf('        --------------------------------------------------------------'));
        console.log(sprintf('        %-40s %-7.2f %-7.2f %-7.2f',
            'Percentage of collisions:',
            collisionCounts[0] / totalComparisons * 100,
            collisionCounts[1] / totalComparisons * 100,
            collisionCounts[2] / totalComparisons * 100
        ));
        console.log('');
    }
}

function compareAttacked(hashSets) {
    console.log('Attacks');
    var attackCodes = attacks.map(function(attack, idx) {
        return String.fromCharCode(idx + 65);
    });
    for (var n = 0; n < attacks.length; n++) {
        console.log(attackCodes[n] + ' - ' + attacks[n]);
    }
    console.log('');
    
    var collisions = [];
    var format     = generateFormatString(attackCodes);
    var separator  = generateSeparatorString(attackCodes);
    var header     = sprintf.apply(null, [format, 'Input'].concat(attackCodes)) + '\n' + separator;
    for (var i = 0; i < fuzzinesses.length; i++) {
        collisions.push([]);
        console.log('    fuzziness = ' + fuzzinesses[i] + '\n');
        for (var j = 0; j < resolutions.length; j++) {
            collisions[i].push(attacks.map(function() { return 0; }));
            console.log('        resolution = ' + resolutions[j] + '\n');
            console.log(header);
            for (var k = 0; k < files.length; k++) {
                var attackedHashes = hashSets[i][j][k];
                var originalHash = hashesOriginal.value()[i][j][k];
                var distances = attackedHashes.map(function (hash, idx) {
                    return hd(hash, originalHash);
                });
                console.log(sprintf.apply(null, [format, files[k]].concat(distances)));
                distances.forEach(function (distance, idx) {
                    if (distance == 0) collisions[i][j][idx]++;
                });
            }
            console.log(separator);
            console.log(sprintf.apply(null, [format, 'Total collisions:'].concat(collisions[i][j])));
            console.log('');
        }
    }
    
    console.log('Percentage of collisions across all attacks per resolution/fuzziness pair:\n');
    console.log(sprintf('         %-6s res=%-6d res=%-6d res=%-6d', '', resolutions[0], resolutions[1], resolutions[2]));
    console.log('    ---------+------------------------------');
    var totalComparisons = files.length * attacks.length;
    for (var i = 0; i < fuzzinesses.length; i++) {
        process.stdout.write(sprintf('    fuzz=%-3d %-3s', fuzzinesses[i], '|'));
        for (var j = 0; j < resolutions.length; j++) {
            var totalCollisions = collisions[i][j].reduce(function (x, y) { return x + y });
            process.stdout.write(sprintf('%-10.2f ', totalCollisions / totalComparisons * 100));
        }
        process.stdout.write('\n');
    }
    console.log('\nA total of ' + files.length + ' images under ' + attacks.length + ' attacks were examined.\n');
}

function computeDistanceStrings(distances, idx) {
    return distances.map(function(distance) {
        return (distance == 0 && idx > 0) ? '0 !' : distance.toString();
    });
}

function generateFormatString(attackCodes) {
    var format    = ['            %-40s'];
    for (var i = 0; i < attackCodes.length; i++) {
        format.push(' %-7s');
    }
    return format.join('');
}

function generateSeparatorString(attackCodes) {
    var separator = ['            ----------------------------------------'];
    for (var i = 0; i < attackCodes.length; i++) {
        separator.push('--------');
    }
    return separator.join('');
}
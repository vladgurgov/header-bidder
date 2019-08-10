var http = require('http');
const zlib = require('zlib');

var port = process.env.PORT || 80;
const path = '/prebid';
const healthcheck = '/healthcheck';

const bidResponseTemplate = JSON.stringify(require('./bidResponse.stub.json'));
const supporteMedia = { "banner-300x250": bidResponseTemplate };
const noBidTemplate = JSON.stringify(require('./nobid.stub.json'));


// gets array of all possible media combination like ['banner-300x250','banner-300x600] that would satisfy request
function getTagKeys(tag) {
    var keys = [];
    if (tag.ad_types && tag.ad_types.length > 0 && tag.ad_types && tag.ad_types.length > 0) {
        tag.ad_types.forEach(function(ad_type) {
            tag.sizes.forEach(function(size) {
                key = ad_type + "-" + size.width + "x" + size.height;
                if (!keys.includes(key)) {
                    keys.push(key);
                }
            });
        });
        return keys;
    }
    return [];
}

// fill-in bidResponse template based on tag - id, uuid
function fillBidResponse(tag, bidResponseTemplate) {
    bidResponseTemplate.uuid = tag.uuid;
    bidResponseTemplate.tag_id = tag.id;
    if (tag.cpm && bidResponseTemplate.ads && bidResponseTemplate.ads[0] && bidResponseTemplate.ads[0].cpm){
        bidResponseTemplate.ads[0].cpm = tag.cpm;
    }
    return bidResponseTemplate;
}

// based on whats requested in bidrequest for given tag and whats available on server (supporteMedia) -- respond to each tag - with either bid or nobid
function generateBidResponse(tag) {
    var requestedKeys = getTagKeys(tag);
    if (requestedKeys.length == 0) {
        return fillBidResponse(tag, JSON.parse(noBidTemplate));
    }
    for (key of requestedKeys) {
        if (supporteMedia[key]) {
            var filled = fillBidResponse(tag, JSON.parse(supporteMedia[key]));
            return filled;
        }
    }
    return fillBidResponse(tag, JSON.parse(noBidTemplate));
}
// bid or nobid on each tag in bidRequest
function respondToAllTag(bidRequest) {
    var tags = bidRequest.tags;
    response_tags = [];
    if (tags && tags.length > 0) {
        tags.forEach(function(tag) {
            response_tags.push(generateBidResponse(tag));
        });
    }
    return response_tags;
}

// return bid response for all requestd tags combined 
function combinedBidResponse(bidRequest) {
    return JSON.stringify({
        "version": "3.0.0",
        "tags": respondToAllTag(bidRequest)
    })
}

function writeEncoded(request, response, buffer) {
    var acceptEncoding = request.headers['accept-encoding'];
    if (!acceptEncoding) {
        acceptEncoding = '';
    }

    if (/\bgzip\b/.test(acceptEncoding)) {
        response.setHeader('Content-Encoding', 'gzip');
        response.write(zlib.gzipSync(buffer)); // raw.pipe(zlib.createGzip()).pipe(response);        
    } else if (/\bdeflate\b/.test(acceptEncoding)) {
        response.setHeader('Content-Encoding', 'deflate');
        response.write(zlib.deflateSync(buffer)); //raw.pipe(zlib.createDeflate()).pipe(response);
    } else if (/\bbr\b/.test(acceptEncoding)) {
        response.setHeader('Content-Encoding', 'br');
        response.write(zlib.brotliCompressSync(buffer)); // raw.pipe(zlib.createBrotliCompress()).pipe(response);
    } else {
        response.write(buffer);
    }
}
//start a server
http.createServer((request, response) => {
    const { headers, method, url } = request;
    let body = [];
    request.on('error', (err) => {
        console.error(err);
    }).on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        console.log("requested url: " + url);
        if (url.startsWith(path)) {
            body = Buffer.concat(body).toString();
            if ((body) && (body.length > 0)) {
                try {
                    var bidRequest = JSON.parse(body);
                    console.log('got request: ' + body)
                    var res = combinedBidResponse(bidRequest);
                    response.setHeader('Content-Type', 'application/json');
                    if (headers['origin']) {
                        console.log('got Origin: ' + headers['origin']);
                        response.setHeader('Access-Control-Allow-Credentials', 'true');
                        response.setHeader('Access-Control-Allow-Origin', headers['origin']);
                    }
                    response.statusCode = 200;
                    console.log('bid response: ' + res);
                    writeEncoded(request, response, res);
                } catch (err) {
                    console.log(err);
                    response.statusCode = 500;
                    writeEncoded(request, response, 'invalid bid request');
                }
            }
        } else if (url.startsWith(healthcheck)){
            response.statusCode = 200;
            console.log('healthcheck = OK');
            response.write("OK");
        }
        response.end();
    });
}).listen(port); //the server object listens on port
console.log('Server running at http://127.0.0.1:' + port + '/');
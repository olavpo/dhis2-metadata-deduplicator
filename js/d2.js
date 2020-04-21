const request = require("request");

let serverInfo;
function init(info) {
	serverInfo = info;
}

function info() {
	return serverInfo;
}


/** DHIS2 COMMUNICATION */
async function d2Get(apiResource) {
	var url = serverInfo.url + "/api/" + apiResource;
	if (url.indexOf("?") >= 0) url += "&paging=false";
	else url += "?paging=false";
	console.log(url);
	return new Promise(function(resolve, reject) {
		// Do async job
		request.get({
			uri: url,
			json: true,
			auth: {
				"user": serverInfo.username,
				"pass": serverInfo.password
			}
		}, function (error, response, data) {
			if (!error && response.statusCode === 200) {
				resolve(data);
			}
			else {
				console.log("Error in GET");
				console.log(error.message);
				reject({"data": data, "error": error, "status": response});
			}
		});
	});
}

async function d2Post(apiResource, data) {
	var url = serverInfo.url + "/api/" + apiResource;

	return new Promise(function(resolve, reject) {
		request.post({
			uri: url,
			json: true,
			body: data,
			auth: {
				"user": serverInfo.username,
				"pass": serverInfo.password
			}
		}, function (error, response, data) {
			if (!error && response.statusCode === 200) {
				resolve(data);
			}
			else {
				console.log("Error in POST");
				console.log(data);
				reject({"data": data, "error": error, "status": response.statusCode});
			}
		});
	});
}

module.exports = {
	"init": init,
	"info": info,
	"post": d2Post,
	"get": d2Get
};
const inquirer = require("inquirer");
const Q = require("q");
const request = require("request");
const fs = require('fs');

console.log("DHIS2 metadata de-duplicator");

var serverInfo = {
	"url": null,
	"username": null,
	"password": null	
};
var metadata;


function start() {
	var initialInput = [
		{
			"type": "input",
			"name": "url",
			"message": "URL",
			"default": "https://play.dhis2.org/2.30"
		},
		{
			"type": "input",
			"name": "username",
			"message": "Username",
			"default": "admin"
		},
		{
			"type": "password",
			"name": "password",
			"message": "Password",
			"default": "district"
		}
	];

	inquirer.prompt(initialInput).then(answers => {
		serverInfo.url = answers.url;
		serverInfo.username = answers.username;
		serverInfo.password = answers.password;
		
		chooseOperation();
	});
}

function chooseOperation() {
	var initialInput = [
		{
			type: "list",
			name: "type",
			message: "Metadata type to de-duplicate",
			choices: ["categoryOptions", "categories", "categoryCombos"]
		}
	];

	inquirer.prompt(initialInput).then(answers => {
		metadata = {};

		switch (answers.type) {
		case "categoryOptions":
			categoryOptions();
			break;
		case "categories":
			categories();
			break;
		default:
			console.log("Not implemented");
		}

	});
}

function categories() {
	catFetch().then(catData => {
		let duplicates = catDupes(catData);
		catPromptDupes(duplicates, catData).then(results => {
			//Iterate over each "group" of duplicates
			var promises = [];
			for (dup of results) {
				
				catFilterAndPrefix(catData, dup.duplicates)
				catAddMaster(catData, dup.master)

				//Fix catcombo references
				promises.push(catReferences(dup.master, dup.duplicates));

				//Fix favourite references
				promises.push(catFavReferences("charts", dup.master, dup.duplicates));
				promises.push(catFavReferences("reportTables", dup.master, dup.duplicates));
			}

			//Add categories to metadata
			metadata["categories"] = catData.duplicates.concat(catData.master);

			Q.all(promises).then(results => {
				for (let status of results) {
					if (!status) {
						console.log("Problem preparing metadata to be updated. Cancelling.");
						console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
						console.log(results);
						return;
					}
				}

				//Post the updated metadata
				fs.writeFile ("metadata.json", JSON.stringify(metadata), function(err) {
					if (err) throw err;
					console.log("metadata.json written");
				});
				d2Post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata).then(result => {
					console.log("Update sent. Status: " + result.status);
					chooseOperation();
				});
			});
		});
	});
}

async function catPromptDupes(duplicates, catData) {
	let toEliminate = [];
	console.log("\n" + Object.keys(duplicates).length + " potential group(s) of duplicates");
	for (var dupe in duplicates) {
		var choices = [];
		for (var listItem in duplicates[dupe]) {
			choices.push(listItem + ": " + getName(listItem,catData.all));			
		}
		let { master } = await inquirer.prompt([{
			"type": "list",
			"name": "master",
			"message": "Master category to keep",
			"choices": choices
		}])
		
		var remainingChoices = [];
		for (var choice of choices) {
			if (choice != master) remainingChoices.push(choice);
		}

		let { dupes } = await inquirer.prompt([{
			"type": "checkbox",
			"name": "dupes",
			"message": "Duplicate categories to remove",
			"choices": remainingChoices
		}])
		var dupeIds = [];
		for (var d of dupes) {
			dupeIds.push(d.split(":")[0]);
		}
		toEliminate.push({"master": master.split(":")[0], "duplicates": dupeIds});
		console.log("\n")	
	}

	return toEliminate;
}

function catDupes(catData) {
	var all = [];
	for (let cat of catData.all) {
		var info = {"id": cat.id, "opts": [], "compareString": ""};
		for (var co of cat.categoryOptions) {
			info.opts.push(co.id);
		}
		info.opts.sort();
		info.compareString = info.opts.join("");
		all.push(info);
	}

	var duplicates = {};
	for (let cat of all) {
		for (let otherCat of all) {
			if (cat.compareString == otherCat.compareString && cat.id != otherCat.id) {
				if (!duplicates[cat.compareString]) duplicates[cat.compareString] = {};
				duplicates[cat.compareString][cat.id] = true;
				duplicates[cat.compareString][cat.id] = true;
			}
		}
	}
	return duplicates;
}

function catFilterAndPrefix(catData, duplicates) {
	for (let cat of catData.all) {
		if (duplicates.indexOf(cat.id) >= 0) {
			cat.name = "00 DUPLICATE " + cat.name;
			catData.duplicates.push(cat);
		}
	}
}
function catAddMaster(catData, master) {
	for (var cat of catData.all) {
		if (master == cat.id) {
			catData.master.push(cat);
		}
	}
}

function catFetch() {
	var deferred = Q.defer();
	var apiResource = "categories.json?fields=:owner";
	d2Get(apiResource).then(function (data) {
		deferred.resolve({"all": data.categories, "duplicates": [], "master": []});
	});

	return deferred.promise;
}

function catReferences(masterId, duplicateIds) {
	var deferred = Q.defer();
	refCatFetch("categoryCombos", duplicateIds).then(objs => {
		for (let cc of objs) {
			let uniqueCats = {};
			for (let cat of cc.categories) {
				if (duplicateIds.indexOf(cat.id) >= 0) {
					uniqueCats[masterId] = true;
				}
				else {
					uniqueCats[cat.id] = true;
				}
			}
			cc.categories = [];
			for (let cat in uniqueCats) {
				cc.categories.push ({"id": cat});
			}
		}
		metadata["categoryCombos"] = objs;
		deferred.resolve(true);
	});
	return deferred.promise;
}

function catFavReferences(type, masterId, duplicateIds) {
	var deferred = Q.defer();
	refCatFavFetch(type, duplicateIds).then(objs => {
		for (let obj of objs) {
			for (let catDim of obj.categoryDimensions) {
				let uniqueCos = {};
				if (duplicateIds.indexOf(catDim.category.id) >= 0) {
					catDim.category.id = masterId;
				}
			}
		}
		metadata[type] = objs;
		deferred.resolve(true);
	});
	return deferred.promise;
}

function categoryOptions() {
	console.log("Deduping categoryOptions");

	var optionInput = [
		{
			"type": "input",
			"name": "master",
			"message": "Option to keep (UID)",
			"default": "FbLZS3ueWbQ"
		},
		{
			"type": "input",
			"name": "duplicates",
			"message": "Options to eliminate (comma separated UIDs)",
			"default": "btOyqprQ9e8,nuHLu6GaiWI"
		}
	];

	inquirer.prompt(optionInput).then(answers => {
		var master = answers.master;
		var duplicates = answers.duplicates.split(",");

		//Fetch the options in question
		coFetch(master,duplicates).then( coData => {

			//"Merge" the options - currently just merging orgunit references
			coMergeOu(coData.master, coData.duplicates);

			//Mark the duplicates with a "DUPLICATE" prefix
			coPrefix(coData.duplicates);

			metadata["categoryOptions"] = coData.duplicates;
			metadata["categoryOptions"].push(coData.master);


			//Fetch and modify related metadata objects
			var promises = [];
			promises.push(coReferences("categoryOptionGroups", master, duplicates));
			promises.push(coReferences("categoryOptionCombos", master, duplicates));
			promises.push(coReferences("categories", master, duplicates));
			promises.push(coFavReferences("charts", master, duplicates));
			promises.push(coFavReferences("reportTables", master, duplicates));

			Q.all(promises).then(results => {
				console.log(results);
				for (let status of results) {
					if (!status) {
						console.log("Problem preparing metadata to be updated. Cancelling.");
						console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
						console.log(results);
						return;
					}
				}
				//console.log(metadata);

				//Post the updated metadata
				/*fs.writeFile ("metadata.json", JSON.stringify(metadata), function(err) {
					if (err) throw err;
					console.log("metadata.json written");
				});*/
				d2Post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata).then(result => {
					console.log("Update sent. Status: " + result.status);
					chooseOperation();
				});			
				
			});
		});
	});
}


function coReferences(type, masterId, duplicateIds) {
	var deferred = Q.defer();
	refFetch(type, duplicateIds).then(objs => {
		for (let obj of objs) {
			let uniqueCos = {};
			for (let co of obj.categoryOptions) {
				if (duplicateIds.indexOf(co.id) >= 0) {
					uniqueCos[masterId] = true;
				}
				else {
					uniqueCos[co.id] = true;
				}
			}
			obj.categoryOptions = [];
			for (let co in uniqueCos) {
				obj.categoryOptions.push ({"id": co});
			}
		}
		metadata[type] = objs;
		deferred.resolve(true);
	});
	return deferred.promise;
}

function coFavReferences(type, masterId, duplicateIds) {
	var deferred = Q.defer();
	refFavFetch(type, duplicateIds).then(objs => {
		for (let obj of objs) {
			for (let cat of obj.categoryDimensions) {
				let uniqueCos = {};
				for (let co of cat.categoryOptions) {
					if (duplicateIds.indexOf(co.id) >= 0) {
						uniqueCos[masterId] = true;
					}
					else {
						uniqueCos[co.id] = true;
					}
				}
				cat.categoryOptions = [];
				for (let co in uniqueCos) {
					cat.categoryOptions.push ({"id": co});
				}
			}
		}
		metadata[type] = objs;
		deferred.resolve(true);
	});
	return deferred.promise;
}


function coMergeOu(master, duplicates) {
	
	let orgunitsUnique = {};
	for (let opt of duplicates) {
		for (let ou of opt.organisationUnits) {
			orgunitsUnique[ou.id] = true;
		}
	}
	master.orgunits = [];
	for (let ou in orgunitsUnique) {
		master.organisationUnits.push ({"id": ou});
	}
}

function coPrefix(duplicates) {
	for (let opt of duplicates) {
		opt.name = opt.name = "00 DUPLICATE " + opt.name;
	}
}


function refFetch(type, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = type + ".json?fields=:owner&filter=categoryOptions.id:in:[" + duplicateIds.join(",") + "]";
	d2Get(apiResource).then(function (data) {
		deferred.resolve(data[type]);
	});

	return deferred.promise;
}

function refCatFetch(type, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = type + ".json?fields=:owner&filter=categories.id:in:[" + duplicateIds.join(",") + "]";
	d2Get(apiResource).then(function (data) {
		deferred.resolve(data[type]);
	});

	return deferred.promise;
}

function refFavFetch(type, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = type + "?fields=:owner&filter=categoryDimensions.categoryOptions.id:in:[" + duplicateIds.join(",") + "]";
	d2Get(apiResource).then(function (data) {
		deferred.resolve(data[type]);
	});

	return deferred.promise;
}

function refCatFavFetch(type, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = type + "?fields=:owner&filter=categoryDimensions.category.id:in:[" + duplicateIds.join(",") + "]";
	d2Get(apiResource).then(function (data) {
		deferred.resolve(data[type]);
	});

	return deferred.promise;
}



function coFetch(masterId, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = "categoryOptions.json?fields=:owner&filter=id:in:[" + masterId + "," + duplicateIds.join(",") + "]";
	d2Get(apiResource).then(function (data) {
		var master = null;
		var duplicates = [];
		for (var opt of data.categoryOptions) {
			if (!master && opt.uid == master) master = opt;
			else duplicates.push (opt);
		}
		deferred.resolve({"master": master, "duplicates": duplicates});
	});

	return deferred.promise;
}

function d2Get(apiResource) {
	var deferred = Q.defer();

	var url = serverInfo.url + "/api/" + apiResource + "&paging=false";
	request.get({
		uri: url,
		json: true,
		auth: {
			"user": serverInfo.username,
			"pass": serverInfo.password
		}
	}, function (error, response, data) {
		if (!error && response.statusCode === 200) {
			deferred.resolve(data);
		}
		else {
			console.log("Error in GET");
			console.log(error.message);
			deferred.reject({'data': data, 'error': error, 'status': response});
		}
	});

	return deferred.promise;
}

function d2Post(apiResource, data) {
	var deferred = Q.defer();
	var url = serverInfo.url + "/api/" + apiResource;

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
			deferred.resolve(data);
		}
		else {
			console.log("Error in POST");
			console.log(data);
			deferred.reject({"data": data, "error": error, "status": response.statusCode});
		}
	});

	return deferred.promise;
}

function getName(id, metadataArray) {
	for (var obj of metadataArray) {
		if (obj.id == id) return obj.name;
	}
	return "";
} 

start();
const inquirer = require("inquirer");
inquirer.registerPrompt("search-checkbox", require("inquirer-search-checkbox"));
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
var metadataDelete;
var metadataFinal;

function start() {
	var initialInput = [
		{
			"type": "input",
			"name": "url",
			"message": "URL",
			"default": "http://localhost:9090/demo"
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
		metadata = {}, metadataDelete = {}, metadataFinal = {};

		switch (answers.type) {
		case "categoryOptions":
			categoryOptions();
			break;
		case "categories":
			categories();
			break;
		case "categoryCombos":
			categoryCombos();
			break;
		default:
			console.log("Not implemented");
		}

	});
}

async function done() {
	var initialInput = [
		{
			type: "checkbox",
			name: "action",
			message: "Metadata ready. Proceed?",
			choices: ["Post to " + serverInfo.url, "Save to metadata.json", "Cancel"]
		}
	];

	let {action} = await inquirer.prompt(initialInput);

	answers = action.join();
	if (answers.indexOf("Cancel") >= 0) {
		chooseOperation();
		return;
	}

	if (!await donePostMetadataPreivew()) {
		console.log("Validation of metadata against " + serverInfo.url + " failed. Cancelling.");
		chooseOperation();
		return;
	}
	else {
		console.log("Validation of metadata against " + serverInfo.url + " succeeded.");
	}
	
	if (answers.indexOf("Save to") >= 0) {
		let result = await doneWriteMetadata();
	}
	if (answers.indexOf("Post to") >= 0) {
		let result = await donePostMetadata();
	}

	chooseOperation();
}

function donePostMetadata() {
	var deferred = Q.defer();
	d2Post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata).then(result => {
		console.log("Updating related metadata on " + serverInfo.url + " Status: " + result.status);
		if (result.status != "OK") {
			console.log("Writing info to ERROR.json");
			fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
				if (err) throw err;
				deferred.resolve(false);
			});
		}
		else {
			d2Post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=DELETE&mergeMode=REPLACE", metadataDelete).then(result => {
				console.log("Deleting duplicate metadata on " + serverInfo.url + " Status: " + result.status);
				if (result.status != "OK") {
					console.log("Writing info to ERROR.json");
					fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
						if (err) throw err;
						deferred.resolve(false);
					});
				}
				else {
					d2Post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadataFinal).then(result => {
						console.log("Updating master metadata on " + serverInfo.url + " Status: " + result.status);
						if (result.status != "OK") {
							console.log("Writing info to ERROR.json");
							fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
								if (err) throw err;
								deferred.resolve(false);
							});
						}
						else {
							deferred.resolve(true);
						}			
					});	
				}		
			});
		}
	});
	return deferred.promise;
}

function donePostMetadataPreivew() {
	var deferred = Q.defer();
	d2Post("metadata.json?dryRun=true&importMode=VALIDATE&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata).then(result => {
		if (result.status != "OK") {
			console.log("Validation of metadata changes failed - see ERROR.json");
			fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
				if (err) throw err;
				deferred.resolve(false);
			});
		}
		else {
			d2Post("metadata.json?dryRun=true&importMode=VALIDATE&identifier=UID&importStrategy=DELETE&mergeMode=REPLACE", metadataDelete).then(result => {
				if (result.status != "OK") {
					console.log("Validation of metadata changes failed - see ERROR.json");
					fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
						if (err) throw err;
						deferred.resolve(false);
					});
				}
				deferred.resolve(true);
			});
		}
	});
	return deferred.promise;
}

function doneWriteMetadata() {
	var deferred = Q.defer();
	fs.writeFile ("metadata.json", JSON.stringify(metadata), function(err) {
		if (err) throw err;
		console.log("metadata.json written");
		fs.writeFile ("metadataDelete.json", JSON.stringify(metadataDelete), function(err) {
			if (err) throw err;
			console.log("metadataDelete.json written");
			fs.writeFile ("metadataFinal.json", JSON.stringify(metadataFinal), function(err) {
				if (err) throw err;
				console.log("metadataFinal.json written");
				deferred.resolve(true);
			});
		});
	});
	return deferred.promise;
}

function categoryCombos() {
	comboFetch().then(comboData => {
		let duplicates = catComboDupes(comboData, "categories");
		if (Object.keys(duplicates).length == 0) {
			console.log("No duplicate categoryCombos found!");
			chooseOperation();
			return;
		}
		catComboPromptDupes(duplicates, comboData, "categoryCombos").then(results => {

			console.log(results);

			//Iterate over each "group" of duplicates
			var promises = [], allMasterIds = [], allDuplicateIds = [];
			for (dup of results) {

				allMasterIds.push(dup.master);
				allDuplicateIds = allDuplicateIds.concat(dup.duplicates);
				
				catComboFilterAndPrefix(comboData, dup.duplicates)
				catComboAddMaster(comboData, dup.master)

				promises.push(comboReferences("dataElements", dup.master, dup.duplicates));
				promises.push(comboReferences("dataApprovalWorkflows", dup.master, dup.duplicates));
				promises.push(comboReferences("categoryOptionCombos", dup.master, dup.duplicates));
				promises.push(comboReferences("programs", dup.master, dup.duplicates));
				promises.push(comboReferences("dataSets", dup.master, dup.duplicates));				
			}

			//Add categories to metadata
			metadata["categoryCombos"] = comboData.duplicates.concat(comboData.master);

			Q.all(promises).then(results => {
				for (let status of results) {
					if (!status) {
						console.log("Problem preparing metadata to be updated. Cancelling.");
						console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
						console.log(results);
						return;
					}
				}

				if (prepMetadata("categoryCombos", allMasterIds, allDuplicateIds)) done();
				else chooseOperation();;
			});
		});
	});
}

function categories() {
	catFetch().then(catData => {
		let duplicates = catComboDupes(catData, "categoryOptions");
		if (Object.keys(duplicates).length == 0) {
			console.log("No duplicate categories found!");
			chooseOperation();
			return;
		}
		catComboPromptDupes(duplicates, catData, "categories").then(results => {
			//Iterate over each "group" of duplicates
			var promises = [], allMasterIds = [], allDuplicateIds = [];
			for (dup of results) {

				allMasterIds.push(dup.master);
				allDuplicateIds = allDuplicateIds.concat(dup.duplicates);
				
				catComboFilterAndPrefix(catData, dup.duplicates)
				catComboAddMaster(catData, dup.master)

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

				if (prepMetadata("categories", allMasterIds, allDuplicateIds)) done();
				else chooseOperation();
			});
		});
	});
}


async function catComboPromptDupes(duplicates, data, type) {
	let toEliminate = [];
	console.log("\n" + Object.keys(duplicates).length + " potential group(s) of duplicates");
	for (var dupe in duplicates) {
		var choices = [];
		for (var listItem in duplicates[dupe]) {
			choices.push(listItem + ": " + getName(listItem,data.all));			
		}
		let { master } = await inquirer.prompt([{
			"type": "list",
			"name": "master",
			"message": "Master " + type + " to keep",
			"choices": choices
		}])
		
		var remainingChoices = [];
		for (var choice of choices) {
			if (choice != master) remainingChoices.push(choice);
		}

		let { dupes } = await inquirer.prompt([{
			"type": "checkbox",
			"name": "dupes",
			"message": "Duplicate " + type + " to remove",
			"choices": remainingChoices
		}])
		var dupeIds = [];
		for (var d of dupes) {
			dupeIds.push(d.split(":")[0]);
		}

		toEliminate.push({"master": master.split(":")[0], "duplicates": dupeIds});
		await verifyProps(["name", "code", "publicAccess", "created"], data.all, master.split(":")[0], dupeIds);
		console.log("\n")	
	}

	return toEliminate;
}

async function verifyProps(props, objects, masterId, dupliateIds) {
	var master = getObject(masterId, objects);
	var dupes = dupliateIds.join();

	console.log("Values to use for " + getName(masterId, objects));
	for (let prop of props) {
		var options = [];
		if (master.hasOwnProperty(prop)) options.push(master[prop]);

		for (let obj of objects) {
			if (dupes.indexOf(obj.id) >= 0 && obj.hasOwnProperty(prop)) {
				options.push(obj[prop]);
			}
		}
		
		if (options.length > 0) {
			let { chosenForProp } = await inquirer.prompt([{
				"type": "list",
				"name": "chosenForProp",
				"message": prop,
				"default": master[prop],
				"choices": options
			}]);
			
			master[prop] = chosenForProp;
		}
		
	}
}

function verifyCoProps(props, objects, masterId, dupliateIds) {
	var deferred = Q.defer();

	verifyProps(props, objects, masterId, dupliateIds).then(result => {
		deferred.resolve("true");
	})

	return deferred.promise;

}


function catComboDupes(data, subProp) {
	var all = [];
	for (let cat of data.all) {
		var info = {"id": cat.id, "opts": [], "compareString": ""};
		for (var co of cat[subProp]) {
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


function catComboFilterAndPrefix(catData, duplicates) {
	for (let cat of catData.all) {
		if (duplicates.indexOf(cat.id) >= 0) {
			catData.duplicates.push(cat);
		}
	}
}
function catComboAddMaster(catData, master) {
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

function comboFetch() {
	var deferred = Q.defer();
	var apiResource = "categoryCombos.json?fields=:owner";
	d2Get(apiResource).then(function (data) {
		deferred.resolve({"all": data.categoryCombos, "duplicates": [], "master": []});
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
		
		if (!metadata["categoryCombos"]) metadata["categoryCombos"] = [];
		metadata["categoryCombos"] = metadata["categoryCombos"].concat(objs);

		deferred.resolve(true);
	});
	return deferred.promise;
}


function comboReferences(type, masterId, duplicateIds) {
	var deferred = Q.defer();
	refComboFetch(type, duplicateIds).then(objs => {
		for (let obj of objs) {
			if (duplicateIds.indexOf(obj.categoryCombo.id) >= 0) {
				obj.categoryCombo.id = masterId;
			}
			if (type == "dataSets") {
				
				for (let dse of obj.dataSetElements) {
					if (duplicateIds.indexOf(dse.categoryCombo.id) >= 0) {
						dse.categoryCombo.id = masterId;
					}
				}
			}
		}

		if (!metadata[type]) metadata[type] = [];
		metadata[type] = metadata[type].concat(objs);
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
		if (!metadata[type]) metadata[type] = [];
		metadata[type] = metadata[type].concat(objs);
		
		deferred.resolve(true);
	});
	return deferred.promise;
}

function coMakeChoices() {
	var deferred = Q.defer();

	d2Get("categoryOptions.json").then(data => {
		var choices = [];
		for (let co of data.categoryOptions) {
			if (co.displayName != "default") choices.push({"name": co.id + ": " + co.displayName});
		}
		deferred.resolve(choices);
	});

	return deferred.promise;
}

function categoryOptions() {
	console.log("Deduping categoryOptions");

	coMakeChoices().then(choices => {
		var optionInput = [
			{
				"type": "search-checkbox",
				"name": "options",
				"message": "Related options to de-duplicate",
				"choices": choices,
				"validate": function(answer) {
					if (answer.length < 2) {
						return "At least 2 options must be selected";
					}
					return true;
				}
			}
		];
		inquirer.prompt(optionInput).then(answers => {
			optionInput = [
				{
					"type": "list",
					"name": "master",
					"message": "Master option to keep",
					"choices": answers.options
				}
			];
			inquirer.prompt(optionInput).then(masterAnswer => {
				var masterId = masterAnswer.master.split(":")[0];
				var duplicateIds = [];
				for (let opt of answers.options) {
					var id = opt.split(":")[0];
					if (id != masterId) duplicateIds.push(id);
				}
				categoryOptionMakeChanges(masterId, duplicateIds);
			});
			
		});
	});
}

function categoryOptionMakeChanges(master, duplicates) {
	//Fetch the options in question
	coFetch(master, duplicates).then( coData => {

		//"Merge" the options - currently just merging orgunit references
		coMergeOu(coData.master, coData.duplicates);

		metadata["categoryOptions"] = coData.duplicates;
		metadata["categoryOptions"].push(coData.master);

		

		//Fetch and modify related metadata objects
		var promises = [];
		promises.push(coReferences("categoryOptionGroups", master, duplicates));
		promises.push(coReferences("categoryOptionCombos", master, duplicates));
		promises.push(coReferences("categories", master, duplicates));
		promises.push(coFavReferences("charts", master, duplicates));
		promises.push(coFavReferences("reportTables", master, duplicates));
		promises.push(verifyCoProps(["name", "shortName", "code", "publicAccess", "created"], metadata["categoryOptions"], master, duplicates));

		Q.all(promises).then(results => {
			for (let status of results) {
				if (!status) {
					console.log("Problem preparing metadata to be updated. Cancelling.");
					console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
					console.log(results);
					return;
				}
			}

			if (prepMetadata("categoryOptions", master, duplicates)) done();
			else chooseOperation();
			
		});
	});
}

//Split metadata into "dependencies" to be imported, "duplicates" to be deleted, and "master" to be updated when duplicates are removed (to avoid non-unique names etc)
function prepMetadata(objectType, master, duplicates) {
	var dupString = duplicates.join("");
	metadataDelete[objectType] = [];
	metadataFinal[objectType] = [];
	var remaining = [];
	for (let obj of metadata[objectType]) {
		if (obj.id == master) metadataFinal[objectType].push(obj);
		else if (dupString.indexOf(obj.id) >= 0) metadataDelete[objectType].push(obj);
		else remaining.push(obj);
	}
	metadata[objectType] = remaining;

	return true;
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
		if (!metadata[type]) metadata[type] = [];
		metadata[type] = metadata[type].concat(objs);
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
		if (!metadata[type]) metadata[type] = [];
		metadata[type] = metadata[type].concat(objs);
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

function refComboFetch(type, duplicateIds) {
	var deferred = Q.defer();
	var apiResource = type + ".json?fields=:owner&filter=categoryCombo.id:in:[" + duplicateIds.join(",") + "]";
	if (type == "dataSets") {
		apiResource = type + ".json?fields=:owner&filter=dataSetElements.categoryCombo.id:in:[" + 
			duplicateIds.join(",") + "]&filter=categoryCombo.id:in:[" + 
			duplicateIds.join(",") + "]&rootJunction=OR";
	}
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

function getObject(id, metadataArray) {
	for (var obj of metadataArray) {
		if (obj.id == id) return obj;
	}
	return null;
}

start();
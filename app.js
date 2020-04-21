const fs = require("fs");

const inquirer = require("inquirer");
inquirer.registerPrompt("search-checkbox", require("inquirer-search-checkbox"));

const cat = require("./js/category.js");
const d2 = require("./js/d2.js");


console.log("DHIS2 metadata de-duplicator");

//For emergencies: ignore expired certificates by commenting out this line
//process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;


var metadata, metadataDelete, metadataFinal;

async function start() {
	var initialInput = [
		{
			"type": "input",
			"name": "url",
			"message": "URL",
			"default": "http://localhost:8080/demo"
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

	var answers = await inquirer.prompt(initialInput);
	d2.init({"url": answers.url, "username": answers.username, "password": answers.password});
	
	chooseOperation();
}

async function chooseOperation() {
	var initialInput = [
		{
			type: "list",
			name: "type",
			message: "Metadata type to de-duplicate",
			choices: ["categoryOptions", "categories", "categoryCombos"]
		}
	];

	var answers = await inquirer.prompt(initialInput);
	metadata = {}, metadataDelete = {}, metadataFinal = {};

	var result;

	switch (answers.type) {
	case "categoryOptions":
		result = await cat.categoryOptions();
		break;
	case "categories":
		result = await cat.categories();
		break;
	case "categoryCombos":
		result = await cat.categoryCombos();
		break;
	default:
		console.log("Not implemented");
	}

	if (result) {
		metadata = result.metadata;
		metadataDelete = result.metadataDelete;
		metadataFinal = result.metadataFinal;
		done();
	}
	else chooseOperation();
}


/** PREVIEW, UPLOAD, SAVE */
async function done() {
	var serverInfo = d2.info();
	var initialInput = [
		{
			type: "checkbox",
			name: "action",
			message: "Metadata ready. Proceed?",
			choices: ["Post to " + serverInfo.url, "Save to metadata.json", "Cancel"]
		}
	];

	let {action} = await inquirer.prompt(initialInput);

	let answers = action.join();
	if (answers.indexOf("Cancel") >= 0) {
		chooseOperation();
		return;
	}

	if (!await donePostMetadataPreview()) {
		console.log("Validation of metadata against " + serverInfo.url + " failed. Cancelling.");
		chooseOperation();
		return;
	}
	else {
		console.log("Validation of metadata against " + serverInfo.url + " succeeded.");
	}
	
	if (answers.indexOf("Save to") >= 0) {
		await doneWriteMetadata();
	}
	if (answers.indexOf("Post to") >= 0) {
		await donePostMetadata();
	}

	chooseOperation();
}

async function donePostMetadata() {
	var serverInfo = d2.info();
	
	var result = await d2.post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata);
	console.log("Updating related metadata on " + serverInfo.url + " Status: " + result.status);
	if (result.status != "OK") {
		console.log("Writing info to ERROR.json");
		fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
			if (err) throw err;
			return false;
		});
	}
	else {
		result = await d2.post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=DELETE&mergeMode=REPLACE", metadataDelete);
		console.log("Deleting duplicate metadata on " + serverInfo.url + " Status: " + result.status);
		if (result.status != "OK") {
			console.log("Writing info to ERROR.json");
			fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
				if (err) throw err;
				return false;
			});
		}
		else {
			result = await d2.post("metadata.json?importMode=COMMIT&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadataFinal);
			console.log("Updating master metadata on " + serverInfo.url + " Status: " + result.status);
			if (result.status != "OK") {
				console.log("Writing info to ERROR.json");
				fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
					if (err) throw err;
					return false;
				});
			}
			else {
				return true;
			}			
		}		
	}
}

async function donePostMetadataPreview() {
	var result = await d2.post("metadata.json?dryRun=true&importMode=VALIDATE&identifier=UID&importStrategy=UPDATE&mergeMode=REPLACE", metadata);
	if (result.status != "OK") {
		console.log("Validation of metadata changes failed - see ERROR.json");
		fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
			if (err) throw err;
			return false;
		});
	}
	else {
		result = await d2.post("metadata.json?dryRun=true&importMode=VALIDATE&identifier=UID&importStrategy=DELETE&mergeMode=REPLACE", metadataDelete);
		if (result.status != "OK") {
			console.log("Validation of metadata changes failed - see ERROR.json");
			fs.writeFile ("ERROR.json", JSON.stringify(result), function(err) {
				if (err) throw err;
				return false;
			});
		}
		return true;
	}
}

async function doneWriteMetadata() {
	fs.writeFile ("metadata.json", JSON.stringify(metadata), function(err) {
		if (err) throw err;
		console.log("metadata.json written");
		fs.writeFile ("metadataDelete.json", JSON.stringify(metadataDelete), function(err) {
			if (err) throw err;
			console.log("metadataDelete.json written");
			fs.writeFile ("metadataFinal.json", JSON.stringify(metadataFinal), function(err) {
				if (err) throw err;
				console.log("metadataFinal.json written");
				return true;
			});
		});
	});
}


start();
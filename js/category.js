const inquirer = require("inquirer");
inquirer.registerPrompt("search-checkbox", require("inquirer-search-checkbox"));

const d2 = require("./d2.js");
var metadata;
var metadataDelete;
var metadataFinal;

async function categoryCombos() {
	metadata = {}, metadataDelete = {}, metadataFinal = {};
	var comboData = await comboFetch();
	if (!comboData.all) {
		console.log("No categoryCombos found!");
		return false;
	}

	let duplicates = findDupesCategoryCatcombo(comboData, "categories");
	if (Object.keys(duplicates).length == 0) {
		console.log("No duplicate categoryCombos found!");
		return false;
	}
	var results = await promptDupesCategoryCatcombo(duplicates, comboData, "categoryCombos");

	//Iterate over each "group" of duplicates
	var promises = [], allMasterIds = [], allDuplicateIds = [];
	for (let dup of results) {

		allMasterIds.push(dup.master);
		allDuplicateIds = allDuplicateIds.concat(dup.duplicates);
		
		catComboFilterAndPrefix(comboData, dup.duplicates);
		catComboAddMaster(comboData, dup.master);

		promises.push(comboReferences("dataElements", dup.master, dup.duplicates));
		promises.push(comboReferences("dataApprovalWorkflows", dup.master, dup.duplicates));
		promises.push(comboReferences("categoryOptionCombos", dup.master, dup.duplicates));
		promises.push(comboReferences("programs", dup.master, dup.duplicates));
		promises.push(comboReferences("dataSets", dup.master, dup.duplicates));				
	}

	//Add categories to metadata
	metadata["categoryCombos"] = comboData.duplicates.concat(comboData.master);

	results = await Promise.all(promises);
	for (let status of results) {
		if (!status) {
			console.log("Problem preparing metadata to be updated. Cancelling.");
			console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
			console.log(results);
			return false;
		}
	}

	if (prepMetadata("categoryCombos", allMasterIds, allDuplicateIds)) {
		return { "metadata": metadata, "metadataDelete": metadataDelete, "metadataFinal": metadataFinal };
	}
	else return false;
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

async function categories() {
	metadata = {}, metadataDelete = {}, metadataFinal = {};
	var catData = await catFetch();
	var duplicates = findDupesCategoryCatcombo(catData, "categoryOptions");
	if (Object.keys(duplicates).length == 0) {
		console.log("No duplicate categories found!");
		return false;
	}

	var results = await promptDupesCategoryCatcombo(duplicates, catData, "categories");
	
	//Iterate over each "group" of duplicates
	var promises = [], allMasterIds = [], allDuplicateIds = [];
	for (let dup of results) {

		allMasterIds.push(dup.master);
		allDuplicateIds = allDuplicateIds.concat(dup.duplicates);
		
		catComboFilterAndPrefix(catData, dup.duplicates);
		catComboAddMaster(catData, dup.master);

		//Fix catcombo references
		promises.push(catReferences(dup.master, dup.duplicates));

		//Fix favourite references
		promises.push(catFavReferences("charts", dup.master, dup.duplicates));
		promises.push(catFavReferences("reportTables", dup.master, dup.duplicates));
	}

	//Add categories to metadata
	metadata["categories"] = catData.duplicates.concat(catData.master);

	results = await Promise.all(promises);
	for (let status of results) {
		if (!status) {
			console.log("Problem preparing metadata to be updated. Cancelling.");
			console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
			console.log(results);
			return false;
		}
	}

	if (prepMetadata("categories", allMasterIds, allDuplicateIds)) {
		return { "metadata": metadata, "metadataDelete": metadataDelete, "metadataFinal": metadataFinal };
	}
	else return false;
}

/** SHARED CATEGORY-RELATED FUNCTIONS */
async function promptDupesCategoryCatcombo(duplicates, data, type) {
	let toEliminate = [];
	console.log("\n" + Object.keys(duplicates).length + " potential group(s) of duplicates");
	for (var dupe in duplicates) {
		var choices = [];
		for (var listItem in duplicates[dupe]) {
			choices.push(listItem + ": " + getName(listItem,data.all));			
		}
		choices.push("[Skip]");
		let { master } = await inquirer.prompt([{
			"type": "list",
			"name": "master",
			"message": "Master " + type + " to keep",
			"choices": choices
		}]);
		if (master != "[Skip]") {
			var remainingChoices = [];
			for (var choice of choices) {
				if (choice != master && choice != "[Skip]") remainingChoices.push(choice);
			}

			let { dupes } = await inquirer.prompt([{
				"type": "checkbox",
				"name": "dupes",
				"message": "Duplicate " + type + " to remove",
				"choices": remainingChoices
			}]);
			var dupeIds = [];
			for (var d of dupes) {
				dupeIds.push(d.split(":")[0]);
			}

			toEliminate.push({"master": master.split(":")[0], "duplicates": dupeIds});
			await verifyProps(["name", "code", "publicAccess"], data.all, master.split(":")[0], dupeIds);
			console.log("\n");	
		}
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

function findDupesCategoryCatcombo(data, subProp) {
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

async function catReferences(masterId, duplicateIds) {
	var objs = await refCatFetch("categoryCombos", duplicateIds);
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

	return true;
}

async function comboReferences(type, masterId, duplicateIds) {
	var objs = await refComboFetch(type, duplicateIds);
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
	return true;
}

async function catFavReferences(type, masterId, duplicateIds) {
	let objs = await refCatFavFetch(type, duplicateIds);
	for (let obj of objs) {
		for (let catDim of obj.categoryDimensions) {
			if (duplicateIds.indexOf(catDim.category.id) >= 0) {
				catDim.category.id = masterId;
			}
		}
	}
	if (!metadata[type]) metadata[type] = [];
	metadata[type] = metadata[type].concat(objs);
		
	return true;
}

async function coMakeChoices() {
	let data = await d2.get("categoryOptions.json");
	var choices = [];
	for (let co of data.categoryOptions) {
		if (co.displayName != "default") choices.push({"name": co.id + ": " + co.displayName});
	}
	return choices;
}

async function categoryOptions() {
	metadata = {}, metadataDelete = {}, metadataFinal = {};

	var { master, duplicates } = await promptDupesCategoryOptions();
	
	//Fetch the options in question
	let coData = await coFetch(master, duplicates);

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

	var results = await Promise.all(promises);
	for (let status of results) {
		if (!status) {
			console.log("Problem preparing metadata to be updated. Cancelling.");
			console.log("categoryOptionGroups, categoryOptionCombos, categories, charts, reportTables");
			console.log(results);
			return;
		}
	}

	await verifyProps(["name", "shortName", "code", "publicAccess"], metadata["categoryOptions"], master, duplicates);
	if (prepMetadata("categoryOptions", master, duplicates)) {
		return { "metadata": metadata, "metadataDelete": metadataDelete, "metadataFinal": metadataFinal };
	}
	else return false;
	
}

async function promptDupesCategoryOptions() {
	var choices = await coMakeChoices();
	var optionInput = [
		{
			"type": "search-checkbox",
			"name": "options",
			"message": "Related options to de-duplicate",
			"choices": choices,
			"pageSize": 20,
			"validate": function(answer) {
				if (answer.length < 2) {
					return "At least 2 options must be selected";
				}
				return true;
			}
		}
	];
	var answers = await inquirer.prompt(optionInput);
	optionInput = [
		{
			"type": "list",
			"name": "master",
			"message": "Master option to keep",
			"choices": answers.options
		}
	];

	var masterAnswer = await inquirer.prompt(optionInput);
	var masterId = masterAnswer.master.split(":")[0];
	var duplicateIds = [];
	for (let opt of answers.options) {
		var id = opt.split(":")[0];
		if (id != masterId) duplicateIds.push(id);
	}

	return { "master": masterId, "duplicates": duplicateIds };

}



async function coReferences(type, masterId, duplicateIds) {
	var objs = await refFetch(type, duplicateIds);
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
	return true;
}

async function coFavReferences(type, masterId, duplicateIds) {
	var objs = await refFavFetch(type, duplicateIds);
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
	return true;
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


/** UTILITIES FOR FETCHING METADATA */
async function catFetch() {
	var apiResource = "categories.json?fields=:owner";
	var data = await d2.get(apiResource);
	return {"all": data.categories, "duplicates": [], "master": []};
}

async function comboFetch() {
	var apiResource = "categoryCombos.json?fields=:owner";
	var data = await d2.get(apiResource);
	return {"all": data.categoryCombos, "duplicates": [], "master": []};
}

async function refFetch(type, duplicateIds) {
	var apiResource = type + ".json?fields=:owner&filter=categoryOptions.id:in:[" + duplicateIds.join(",") + "]";
	var data = await d2.get(apiResource);
	return data[type];	
}

async function refCatFetch(type, duplicateIds) {	
	var apiResource = type + ".json?fields=:owner&filter=categories.id:in:[" + duplicateIds.join(",") + "]";
	var data = await d2.get(apiResource);
	return data[type];
}

async function refComboFetch(type, duplicateIds) {
	var apiResource = type + ".json?fields=:owner&filter=categoryCombo.id:in:[" + duplicateIds.join(",") + "]";
	if (type == "dataSets") {
		apiResource = type + ".json?fields=:owner&filter=dataSetElements.categoryCombo.id:in:[" + 
			duplicateIds.join(",") + "]&filter=categoryCombo.id:in:[" + 
			duplicateIds.join(",") + "]&rootJunction=OR";
	}
	var data = await d2.get(apiResource);
	return data[type];
}

async function refFavFetch(type, duplicateIds) {
	var apiResource = type + "?fields=:owner&filter=categoryDimensions.categoryOptions.id:in:[" + duplicateIds.join(",") + "]";
	var data = await d2.get(apiResource);
	return data[type];
}

async function refCatFavFetch(type, duplicateIds) {
	var apiResource = type + "?fields=:owner&filter=categoryDimensions.category.id:in:[" + duplicateIds.join(",") + "]";
	var data = await d2.get(apiResource);
	return data[type];
}

async function coFetch(masterId, duplicateIds) {
	var apiResource = "categoryOptions.json?fields=:owner&filter=id:in:[" + masterId + "," + duplicateIds.join(",") + "]";
	var data = await d2.get(apiResource);
	
	var duplicates = [], master = null;
	for (var opt of data.categoryOptions) {
		if (!master && opt.uid == master) master = opt;
		else duplicates.push (opt);
	}
	return {"master": master, "duplicates": duplicates};
}


/** UTILITIES */
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


module.exports = {
	"categoryCombos": categoryCombos,
	"categories": categories,
	"categoryOptions": categoryOptions
};

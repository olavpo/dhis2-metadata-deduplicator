const inquirer = require("inquirer");

console.log("DHIS2 metadata de-duplicator");

var serverInfo = {
	"url": null,
	"username": null,
	"password": null	
};


function start() {
	var initialInput = [
		{
			"type": "input",
			"name": "url",
			"message": "URL",
			"default": "https://play.dhis2.org/demo"
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
		},
		{
			type: "list",
			name: "type",
			message: "Metadata type to de-duplicate",
			choices: ["categoryOptions", "categories", "categoryCombos"]
		}
	];

	inquirer.prompt(initialInput).then(answers => {
		serverInfo.url = answers.url;
		serverInfo.username = answers.username;
		serverInfo.password = answers.password;

		switch (answers.type) {
		case "categoryOptions":
			categoryOptions();
			break;
		default:
			console.log("Not implemented");
		}

	});
}

function categoryOptions() {
	console.log("Deduping categoryOptions");
}


start();
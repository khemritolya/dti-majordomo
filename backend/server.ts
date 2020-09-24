import { WebClient } from "@slack/web-api";
import express from "express";
import bodyParser from "body-parser";
import Vm from "vm.js";

// A particular endpoint, and all the information associated with it.
interface Endpoint {
    url: string,
    name: string,
    onCallCode: string,
    linkedGithubRepo: string,
    linkedSlackChannel: string
}

let majordomoSuggestionEndpoint: Endpoint = {
    url: "something",
    name: "dti-majordomo-suggestion", 
    onCallCode: 
    `let data = getResponseJson();
    slackPost(\"Someone has a suggestion: \" + data.text);`,
    linkedGithubRepo: "",
    linkedSlackChannel: "#zzz-testing-channel",
}

let gitEndpoint: Endpoint = {
    url: "git",
    name: "dti-majordomo-git",
    onCallCode: `let data`,
    linkedGithubRepo: "https://github.com/ngwattcos/test-repo",
    linkedSlackChannel: "#zzz-testing-channel",
}

// All the endpoints we have on the server
// Why yes, I *am* too lazy to use a DB!
// using Sets allows us to not add duplicates
let endpoints = new Set([ majordomoSuggestionEndpoint ]);

// Check if we have a slack token
if (!process.env.SLACK_TOKEN) {
    console.log("Unable to find slack token!")
} else {
    console.log("Integrating with slack!");
}


// Our window into slack!
// Used to push messages
const slack = new WebClient(process.env.SLACK_TOKEN);


// Very basic
// Function which sends a slack message eventually.
const sendSlackMessage = async function(channel: string, text: string) {
    try {
        await slack.chat.postMessage({
            channel: channel,
            text: text
        });

        console.log(`Sent slack message in ${channel}: ${text}`);
    } catch (err) {
        console.log(`An error has occured while trying to slack post:\n${err}`);
    }
};

// Set up the express server
const httpServer = express();
httpServer.use(bodyParser.urlencoded({ extended: false }));
httpServer.use(bodyParser.json());

// Set up the ability to list for each endpoint
// Question: does this cause a duplication problem? Are dynamic endpoints a thing?
const setupEndpoints = () => {
    console.log(`setting up ${endpoints.size} endpoints`);
    endpoints.forEach(endpoint => {
        httpServer.post(`/custom-endpoints/${endpoint.url}`, async (req, res) => {
            console.log(`Called custon endpoint ${endpoint.name}`);

            // Create VM to run endpoint action code
            const sandbox = new Vm();

            // Define the integration functions that the user can call!
            sandbox.realm.global.getResponseJson = function() { return req.body; };
            sandbox.realm.global.slackPost = function(text: string) {
                return (async () => { await sendSlackMessage(endpoint.linkedSlackChannel, text) })();
            };

            sandbox.eval(endpoint.onCallCode);

            res.send({
                "sucess": true
            });
        });
    })
};

setupEndpoints();

httpServer.get("/", (req, res) => {
    console.log("received a thing");
    res.send("here's the thing");
})
httpServer.post("/create-endpoint", async (req, res) => {
    let body = (req.body) as Endpoint;

    console.log(`Request to create endpoint ${body.name}`);

    endpoints.add(body);

    setupEndpoints();

    res.send(`now have the following endpoints: ${Array.from(endpoints).reduce<Record<symbol, string>>((prev, curr) => `${prev}, ${curr.name}`, "")}`);
})

httpServer.listen(1776, async () => {
    console.log("Starting Webserver on port 1776");
});
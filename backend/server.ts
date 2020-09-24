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
var endpoints: Endpoint[] = [ majordomoSuggestionEndpoint ];

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
endpoints.forEach(endpoint => {
    httpServer.post(`/custom-endpoints/${endpoint.url}`, async (req, res) => {
        console.log("You have reached the endpoint!");

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

httpServer.get("/", (req, res) => {
    console.log("received a thing");
    res.send("here's the thing");
})
httpServer.post("/create-endpoint", async (req, res) => {
    let body = (req.body) as Endpoint;
    console.log(body);


    console.log("Request to create an endpoint");
    res.send("heh");
})

httpServer.listen(1776, async () => {
    console.log("Starting Webserver on port 1776");
});
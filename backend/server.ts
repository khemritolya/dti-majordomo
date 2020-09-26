import { WebClient } from "@slack/web-api";
import express from "express";
import bodyParser from "body-parser";
import Vm from "vm.js";
import crypto from "crypto";
import ipify from "ipify";

// A particular endpoint, and all the information associated with it.
interface Endpoint {
    url: string,
    name: string,
    onCallCode: string,
    linkedGithubRepo: string,
    linkedSlackChannel: string
}

// What slack channel do majordomo things post to?
const majordomoTestingChannel: string = "#majordomo-testing-channel"

// An example suggestions endpoint
let majordomoSuggestionEndpoint: Endpoint = {
    url: "something",
    name: "dti-majordomo-suggestion",
    onCallCode:
    `let data = getResponseJson();
    slackPost(\"Someone has a suggestion: \" + data.text);`,
    linkedGithubRepo: "",
    linkedSlackChannel: majordomoTestingChannel,
}

let gitEndpoint: Endpoint = {
    url: "git",
    name: "dti-majordomo-git",
    onCallCode: `let data`,
    linkedGithubRepo: "https://github.com/ngwattcos/test-repo",
    linkedSlackChannel: majordomoTestingChannel,
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

// What port is this program running on?
const port = 1776

// Hide our endpoint creation endpoints behind this gargabe. We wouldn't want anyone to be able to create endpoints
// Note that we DON'T add this to user created endpoints
// anyone should be able to call those no problem
const randomEndpointAddressModifier = crypto.randomBytes(30).toString("hex");

// Let DTI know how they can contact the server!
(async () => {
    const addr = await ipify({useIPv6: false});

    await sendSlackMessage(majordomoTestingChannel, `Majordomo is up at the following address: http://${addr}:${port}/${randomEndpointAddressModifier}/`);
})();

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

httpServer.get(`/${randomEndpointAddressModifier}`, (req, res) => {
    console.log("Someone tried to navigate to this page!");
    res.send("Sorry mate, that's now how you access this service. Check the github/slack! Cheers");
});

// What to do if someone asks for all the endpoints that are available
httpServer.get(`/${randomEndpointAddressModifier}/get-endpoints`, async (req, res) => {
    res.send(endpoints);
});

// What to do to create a new endpoint
httpServer.post(`/${randomEndpointAddressModifier}/create-endpoint`, async (req, res) => {
    let body = (req.body) as Endpoint;

    console.log(`Request to create endpoint ${body.name}`);

    // NOTE: don't blindly add endpoints, check if they exist in the set
    endpoints.add(body);

    setupEndpoints();

    res.send(`now have the following endpoints: ${Array.from(endpoints).reduce<Record<symbol, string>>((prev, curr) => `${prev}, ${curr.name}`, "")}`);
})

httpServer.listen(port, async () => {
    console.log(`Starting Webserver on port ${port}`);
});

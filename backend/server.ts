import { WebClient } from "@slack/web-api";
import express from "express";
import bodyParser from "body-parser";
import Vm from "vm.js";
import crypto from "crypto";
import ipify from "ipify";
import { Octokit } from "@octokit/core";
import rateLimit, { RateLimit } from "express-rate-limit";

// A particular endpoint, and all the information associated with it.
interface Endpoint {
    url: string,
    name: string,
    description: string,
    onCallCode: string,
    linkedGithubRepo: string,
    linkedSlackChannel: string
}

// What slack channel do majordomo things post to?
const majordomoTestingChannel: string = "#majordomo-testing-channel"

// An example suggestions endpoint
let majordomoSuggestionEndpoint: Endpoint = {
    url: "majordomo-suggestion",
    name: "majordomo-suggestion", // we messed up, these have to be the same now :(
    description: "Allows users to post suggestions about DTI Majordomo to slack!",
    onCallCode:
    `// Get any JSON Data associated with the HTTP POST request
const data = getPostJson();

// Get the IP of whoever posted to the endpoint
const ip = getIpAddr();

// Post the 'text' field of the json to slack!
slackPost(\"A user (\" + ip + \") has a suggestion: \" + data.text);`,
    linkedGithubRepo: "https://github.com/khemritolya/dti-majordomo",
    linkedSlackChannel: majordomoTestingChannel,
}

let majordomoErrorDemoEndpoint: Endpoint = {
    url: "majordomo-error-demo",
    name: "majordomo-error-demo",
    description: "Allows users to post suggestions about DTI Majordomo to slack!",
    onCallCode: 
    `// Get the IP of whoever posted to the endpoint
const ip = getIpAddr();

// Create an issue, we ran into a divide by zero!
// Create a callback to post about it on slack with the issue url! We wou;dn't want to miss it!
createGithubIssue(\"A user (\" + ip + \") has caused a backend error \", \"The user pressed a button which causes a backend error, unsuprisingly causing a backend error. This error is now reported here for all posterity. In a real product, you can make this include actual proper error readout information. We didn't for conveinience. Happy bug fixing!\", function(issueUrl) {
    slackPost(\"<!channel> Heads up! A user (\" + ip + \") ran into an issue: \" + issueUrl)
});
    `,
    linkedGithubRepo: "https://github.com/khemritolya/dti-majordomo",
    linkedSlackChannel: majordomoTestingChannel,
}

// Split  a url like https://github.com/khemritolya/dti-majordomo into khemritolya, dti-majordomo
const splitRepoUrl = function(url: string): [string, string] {
    const urlFragments = url.replace("//", "/").split("/");
    return [urlFragments[2], urlFragments[3]];
}

// All the endpoints we have on the server
// Why yes, I *am* too lazy to use a DB!
// using Sets allows us to not add duplicates
// That is actually incorrect. See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
let endpoints: Endpoint[] = [ majordomoSuggestionEndpoint, majordomoErrorDemoEndpoint ];

// Check if we have a slack token
if (!process.env.SLACK_TOKEN) {
    console.log("Unable to find slack token!")
} else {
    console.log("Integrating with slack!");
}

// Our window into slack!
// Used to push messages
const slack = new WebClient(process.env.SLACK_TOKEN);

// Function which sends a slack message eventually.
const sendSlackMessage = async function(channel: string, text: string, callback?: () => void ) {
    try {
        await slack.chat.postMessage({
            channel: channel,
            text: text
        });

        console.log(`Sent slack message in ${channel}: ${text}`);
        
        if(callback) {
            callback();
        }
    } catch (err) {
        console.log(`An error has occured while trying to slack post:\n${err}`);
    }
};

// Function which creates a github issue
// returns the url of the newly created issue
const createGitubIssue = async function(repoOwner: string, repoName: string, title: string, text: string, callback?: (string) => void) {
    try {
        const issue = await octokit.request('POST /repos/{owner}/{repo}/issues', {
            owner: repoOwner,
            repo: repoName,
            title: title,
            body: text
        });

        const normedUrl = issue.data.url.replace("api.github.com/repos", "github.com");

        console.log(`Created an issue ${normedUrl}`);

        if (callback) {
            callback(normedUrl);
        }

        return issue.url;
    } catch (err) {
        console.log("An error has occured trying to create a github issue!");
    }

}

// Check if we have a github login
if (!process.env.GITHUB_TOKEN) {
    console.log("Unable to find github token!");
} else {
    console.log("Integrating with github!")
}

// Create it here so we can access it later!
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// What port is this program running on?
const port = 17760

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
httpServer.set('trust proxy', true)

httpServer.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
});
// Set up the ability to list for each endpoint
// Question: does this cause a duplication problem? Are dynamic endpoints a thing?
const setupEndpoints = () => {
    console.log(`setting up ${endpoints.length} endpoints`);
    endpoints.forEach(endpoint => {
        httpServer.post(`/custom-endpoints/${endpoint.url}`, async (req, res) => {
            console.log(`Called custon endpoint ${endpoint.name}`);

            const [ repoOwner, repoName ] = splitRepoUrl(endpoint.linkedGithubRepo);

            // Create VM to run endpoint action code
            const sandbox = new Vm();

            // Define the integration functions that the user can call!
            sandbox.realm.global.getPostJson = function() { return req.body; };
            sandbox.realm.global.getIpAddr = function() { return req.ip; };
            sandbox.realm.global.slackPost = function(text: string, callback?: () => void) {
                return (async () => { await sendSlackMessage(endpoint.linkedSlackChannel, text, callback) })();
            };
            sandbox.realm.global.createGithubIssue = function(title: string, text: string, callback?: (string) => void) {
                (async () => await createGitubIssue(repoOwner, repoName, title, text, callback))();
            }

            sandbox.eval(endpoint.onCallCode);

            res.send({
                "sucess": true
            });
        });
    })
};

setupEndpoints();

httpServer.get(`/${randomEndpointAddressModifier}`, async (req, res) => {
    console.log("Someone tried to navigate to this page!");
    res.send("Sorry mate, that's now how you access this service. Check the github/slack! Cheers");
});

httpServer.get(`/${randomEndpointAddressModifier}/ping`, async (req, res) => {
    res.send("pong");
});

// What to do if someone asks for all the endpoints that are available
httpServer.get(`/${randomEndpointAddressModifier}/get-endpoints`, async (req, res) => {
    res.send(endpoints);
});

// What to do to create a new endpoint
httpServer.post(`/${randomEndpointAddressModifier}/create-endpoint`, async (req, res) => {
    let body = JSON.parse(req.body.data) as Endpoint;

    console.log(`Request to create endpoint ${body.name}`);

    // NOTE: don't blindly add endpoints, check if they exist in the set
    const prev = endpoints.filter(e => e.name === body.name);
    if (prev.length === 1) {
        endpoints[endpoints.indexOf(prev[0])] = body;
    } else {
        endpoints.push(body);
    }

    setupEndpoints();

    res.send(`now have the following endpoints: ${Array.from(endpoints).reduce<Record<symbol, string>>((prev, curr) => `${prev}, ${curr.name}`, "")}`);
})

httpServer.listen(port, async () => {
    console.log(`Starting Webserver on port ${port}`);
});

console.log(`!!! For local development purposes, you can use this url to contact this server (i.e. to test endpoints): http://localhost:${port}/${randomEndpointAddressModifier}/`)

const limiter = rateLimit({
    max: 100, // limit each IP to 100 requests per windowMs
    windowMs: 15 * 60 * 1000 // 15 minutes
});
 
httpServer.use(limiter);

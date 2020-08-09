import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import axios from "axios";
import * as querystring from "querystring";
import { AtCoder, AtCoderResult } from "../AtCoder";

function normalizer(text: string) {
  const prettyData = text.split(/“|”|"|'|\s/).filter((v) => v);
  const contestId = prettyData[0].startsWith("abc")
    ? prettyData[0]
    : `abc${prettyData[0]}`;
  const members = prettyData.slice(1).map((v) => v.match(/^<@(\w+)\|\w+>$/)[1]);
  return { contestId, members };
}

async function getUserData() {
  const json = await axios.get(
    "https://atcoder-summary-bot.netlify.app/AtCoderIdMatcher.json"
  );

  const matcher = new Map<string, string>();
  json.data.forEach(({ slackUserId, atCoderId }) => {
    matcher.set(slackUserId, atCoderId);
  });
  return matcher;
}

async function getAtCoderIdFromSlackUserId(members: string[]) {
  const atCoderIdMatcher = await getUserData();

  if (members.length === 0) {
    const data: string[] = [];
    for (const kv of atCoderIdMatcher) {
      const id = kv[1];
      data.push(id);
    }
    return data;
  } else {
    return members.map((m) => atCoderIdMatcher.get(m)).filter((v) => v);
  }
}

interface ResultSummary {
  member: string;
  userPage: string;
  resultSummary: { [key in string]: AtCoderResult };
}

async function main(e: APIGatewayProxyEvent) {
  // console.log(e);
  // console.log(querystring.parse(e.body));
  const query = querystring.parse(e.body);
  // console.log(query.text);

  const postData = normalizer(query.text as string);
  // console.log(postData);
  const contestId = postData.contestId;
  // console.log(contestId);
  const members = await getAtCoderIdFromSlackUserId(postData.members);
  // console.log(members);

  const resultSummary: ResultSummary[] = await Promise.all(
    members.map(async (member) => {
      const atcoder = new AtCoder(contestId, member);
      return atcoder
        .scrapingAtCoderContestResultSummary()
        .then((resultSummary) => ({
          member,
          resultSummary,
          userPage: atcoder.userResultPageUrl,
        }));
    })
  );

  console.log(resultSummary);

  const blocks = msgBuilder(contestId, resultSummary);
  const payload = {
    statusCode: 200,
    response_type: "in_channel",
    blocks,
  };
  console.log("payload", JSON.stringify(payload));
  const res = await axios
    .post(query.response_url as string, JSON.stringify(payload))
    .catch((e) => e);
  console.log(res);
}

function msgBuilder(contestId: string, data: ResultSummary[]) {
  const header = {
    type: "section",
    text: {
      type: "plain_text",
      text: `${contestId.toUpperCase()} Result Summary`,
      emoji: true,
    },
  };
  const divider = {
    type: "divider",
  };

  const body = data
    .map((v) => {
      return Object.keys(v.resultSummary)
        .sort()
        .map((q) => {
          const { title, status, time, detail } = v.resultSummary[q];
          return {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${
                v.member
              } - ${title} / :${status}: / ${time
                .toISOString()
                .replace(/T/, " ")
                .replace(/\..+/, "")} / <${detail}|提出コード>`,
            },
          };
        });
    })
    .filter((v) => v.length)
    .map((v, i, a) => {
      if (a.length - 1 !== i) v.push(divider as any);
      return v;
    })
    .flat();

  console.log("body", body);

  return [header, divider, ...body];
}

export const handler: APIGatewayProxyHandler = async (
  event,
  _context,
  callback
) => {
  try {
    // solution of timed out by 3,000 ms
    callback(null, { statusCode: 202, body: "" });

    if (event.httpMethod !== "POST") return;
    await main(event);
  } catch (err) {
    console.log(err);
    return err;
  }
};

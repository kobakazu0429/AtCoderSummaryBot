import { APIGatewayProxyEvent } from "aws-lambda";
import * as cheerio from "cheerio";
import axios from "axios";
import * as path from "path";
import * as querystring from "querystring";

import { promises as fs } from "fs";

interface AtCoderResult {
  time: Date;
  title: string;
  status: string;
  detail: string;
}

class AtCoder {
  constructor(contestId: string, atCoderId: string) {
    const baseUrl = "https://atcoder.jp";
    this.baseUrl = baseUrl;
    const url = `${baseUrl}/contests/${contestId}/submissions?f.Task=&f.Language=&f.Status=&f.User=${atCoderId}`;
    this.url = url;
  }

  async scrapingAtCoderContestResult() {
    const raw = await this.getRawHtml();
    const result = this.parse(raw);
    const summry = this.summry(result);
    return summry;
  }
  private baseUrl: string;
  private url: string;

  public get userResultPageUrl(): string {
    return this.url;
  }

  async getRawHtml() {
    const result = await axios.get<string>(this.url);
    return result.data;
  }

  parse(html: string) {
    const $ = cheerio.load(html);
    const tr = $("tr");
    const td = tr.slice(1).map((_i, el) => $(el).find("td"));
    const result: AtCoderResult[] = [];
    td.each((_i, el) => {
      const timeEl = $(el).eq(0);
      const titleEl = $(el).eq(1);
      const statusEl = $(el).eq(6);
      const detailEl = $(el).eq(9);
      const time = timeEl.find("time").text();
      const title = titleEl.text();
      const status = statusEl.text();
      const detail = detailEl.find("a").attr("href");

      result.push({
        time: new Date(time),
        title,
        status,
        detail: this.baseUrl + detail,
      });
    });

    return result;
  }

  summry(data: AtCoderResult[]) {
    const summery = {};

    data.forEach((v) => {
      const time = new Date(v.time);
      const Q = v.title[0];
      if (summery[Q] && summery[Q].time > time) return;

      summery[Q] = { ...v, time };
    });

    return summery;
  }
}

function normalizer(text: string) {
  const prettyData = text.split(/“|”|"|'|\s/).filter((v) => v);
  const contestId = prettyData[0].startsWith("abc")
    ? prettyData[0]
    : `abc${prettyData[0]}`;
  const members = prettyData.slice(1).map((v) => v.match(/^<@(\w+)\|\w+>$/)[1]);
  return { contestId, members };
}

async function getUserData() {
  const matcherPath = path.resolve("AtCoderIdMatcher.json");
  const json: Array<{ slackUserId: string; atCoderId: string }> = JSON.parse(
    await fs.readFile(matcherPath, "utf-8")
  );

  const matcher = new Map<string, string>();
  json.forEach(({ slackUserId, atCoderId }) => {
    matcher.set(slackUserId, atCoderId);
  });
  return matcher;
}

async function getAtCoderIdFromSlackUserId(members: string[]) {
  const atCoderIdMatcher = await getUserData();

  if (members.length === 0) {
    const data: string[] = [];
    for (let kv of atCoderIdMatcher) {
      const id = kv[1];
      data.push(id);
    }
    return data;
  } else {
    return members.map((m) => atCoderIdMatcher.get(m)).filter((v) => v);
  }
}

interface Data {
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

  const data: Data[] = await Promise.all(
    members.map(async (member) => {
      const atcoder = new AtCoder(contestId, member);
      return atcoder.scrapingAtCoderContestResult().then((resultSummary) => ({
        member,
        resultSummary,
        userPage: atcoder.userResultPageUrl,
      }));
    })
  );

  console.log(data);

  const blocks = msgBuilder(contestId, data);
  const payload = {
    statusCode: 200,
    blocks,
  };
  console.log("payload", JSON.stringify(payload));
  const res = await axios
    .post(query.response_url as string, JSON.stringify(payload))
    .catch((e) => e);
  console.log(res);
}

function msgBuilder(contestId: string, data: Data[]) {
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

export const handler = async (event: any, context: any, callback: any) => {
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

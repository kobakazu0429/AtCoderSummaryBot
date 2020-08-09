import * as cheerio from "cheerio";
import axios from "axios";

export interface AtCoderResult {
  time: Date;
  title: string;
  status: string;
  detail: string;
}

export class AtCoder {
  constructor(contestId: string, atCoderId: string) {
    const baseUrl = "https://atcoder.jp";
    this.baseUrl = baseUrl;
    const url = `${baseUrl}/contests/${contestId}/submissions?f.Task=&f.Language=&f.Status=&f.User=${atCoderId}`;
    this.url = url;
  }

  private baseUrl: string;
  private url: string;

  async scrapingAtCoderContestResultSummary() {
    const raw = await this.getRawHtml();
    const result = this.parse(raw);
    const summry = this.summry(result);
    return summry;
  }

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

import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async (
  event,
  _context,
  _callback
) => {
  console.log(event);
  return { statusCode: 200, body: "Hello, World !" };
};

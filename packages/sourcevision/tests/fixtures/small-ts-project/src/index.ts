import { UserService } from "./services/user-service.js";
import { formatName } from "./utils/format.js";

export function main() {
  const svc = new UserService();
  const name = formatName("test");
  return { svc, name };
}

import { User, createUser } from "../models/user.js";
import { validateName } from "../utils/validate.js";
import { formatName } from "../utils/format.js";

export class UserService {
  private users: User[] = [];

  add(name: string, email: string): User {
    if (!validateName(name)) throw new Error("Invalid name");
    const user = createUser(formatName(name), email);
    this.users.push(user);
    return user;
  }

  list(): User[] {
    return this.users;
  }
}

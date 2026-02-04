export function loader() {
  return { user: { id: "1", name: "Test" } };
}

export function action() {
  return null;
}

export default function UserPage() {
  return <div><h1>User</h1></div>;
}

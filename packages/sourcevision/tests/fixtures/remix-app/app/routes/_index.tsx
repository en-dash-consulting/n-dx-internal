export function loader() {
  return { message: "Hello" };
}

export function meta() {
  return [{ title: "Home" }];
}

export default function Index() {
  return <main><h1>Home</h1></main>;
}

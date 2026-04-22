export default function Home() {
  const projectId = process.env.PROJECT_ID ?? "unknown";
  return (
    <main style={{ padding: "2rem" }}>
      <h1>Hello from project {projectId}</h1>
      <p>
        This is a placeholder template. Later phases will let you edit the code
        that runs here.
      </p>
    </main>
  );
}

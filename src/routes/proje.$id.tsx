import { Link, createFileRoute } from "@tanstack/react-router";
import { Room } from "@/components/studio/room";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/proje/$id")({
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const { ready, projects } = useStudio();
  const project = projects.find((item) => item.id === id);

  if (!project) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-4">
        <h1 className="text-3xl">{ready ? "Bu çekim masada yok" : "Masa açılıyor"}</h1>
        <p className="text-muted">
          {ready
            ? "Silinmiş ya da hiç açılmamış olabilir."
            : "Kayıtlı çekimler yükleniyor."}
        </p>
        <Link to="/" className="text-sm text-fg underline">
          Masaya dön
        </Link>
      </main>
    );
  }

  return <Room project={project} />;
}

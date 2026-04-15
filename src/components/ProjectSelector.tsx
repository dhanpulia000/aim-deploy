import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";

export default function ProjectSelector() {
  const { t } = useTranslation("components");
  const { projects, selectedProjectId, selectProject } = useAuth();

  const filteredProjects = useMemo(() => {
    return projects.filter(
      (project) =>
        project.name !== "Default Project" &&
        project.name !== "default project" &&
        project.name !== "DEFAULT PROJECT"
    );
  }, [projects]);

  const hasProjects = filteredProjects.length > 0;
  const projectIdValue = selectedProjectId ?? "";

  const label = useMemo(() => {
    if (!hasProjects) return t("projectSelector.empty");
    return t("projectSelector.label");
  }, [hasProjects, t]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {hasProjects ? (
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm shadow-sm"
          value={projectIdValue}
          onChange={(event) => selectProject(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">{t("projectSelector.allProjects")}</option>
          {filteredProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
          {t("projectSelector.createHint")}
        </div>
      )}
    </div>
  );
}

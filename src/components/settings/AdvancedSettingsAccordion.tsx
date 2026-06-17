import type { ReactNode } from "react";
import {
  AlertTriangle,
  Cloud,
  Database,
  FlaskConical,
  FolderSearch,
  HardDriveDownload,
  ScrollText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ADVANCED_SETTINGS_SECTIONS,
  getAdvancedSettingsSupport,
  type AdvancedSettingsSectionId,
  type SettingsTargetMode,
} from "./advancedSupport";

interface AdvancedSettingsAccordionProps {
  targetMode?: SettingsTargetMode;
  defaultValue?: AdvancedSettingsSectionId[];
  descriptions?: Partial<Record<AdvancedSettingsSectionId, string>>;
  childrenBySection: Partial<Record<AdvancedSettingsSectionId, ReactNode>>;
}

const SECTION_ICONS: Record<
  AdvancedSettingsSectionId,
  { node: ReactNode; className: string }
> = {
  directory: {
    node: <FolderSearch className="h-5 w-5 text-primary" />,
    className: "",
  },
  data: {
    node: <Database className="h-5 w-5 text-blue-500" />,
    className: "",
  },
  backup: {
    node: <HardDriveDownload className="h-5 w-5 text-amber-500" />,
    className: "",
  },
  cloudSync: {
    node: <Cloud className="h-5 w-5 text-blue-500" />,
    className: "",
  },
  test: {
    node: <FlaskConical className="h-5 w-5 text-emerald-500" />,
    className: "",
  },
  logConfig: {
    node: <ScrollText className="h-5 w-5 text-cyan-500" />,
    className: "",
  },
};

export function AdvancedSettingsAccordion({
  targetMode = "local",
  defaultValue = [],
  descriptions,
  childrenBySection,
}: AdvancedSettingsAccordionProps) {
  const { t } = useTranslation();

  return (
    <Accordion
      type="multiple"
      defaultValue={defaultValue}
      className="w-full space-y-4"
    >
      {ADVANCED_SETTINGS_SECTIONS.map((section) => {
        const support = getAdvancedSettingsSupport(section.id, targetMode);
        const child = childrenBySection[section.id];
        const title =
          targetMode === "remote"
            ? t(section.titleKey, {
                defaultValue: section.defaultTitle,
              })
            : t(section.titleKey);
        const description =
          descriptions?.[section.id] ??
          (targetMode === "remote"
            ? t(section.descriptionKey, {
                defaultValue: section.defaultDescription,
              })
            : t(section.descriptionKey));
        const content =
          support.status === "unsupported" || !child ? (
            <UnsupportedAdvancedSection
              reason={
                support.reasonKey
                  ? t(support.reasonKey, {
                      defaultValue: support.defaultReason,
                    })
                  : t("remote.settings.advanced.unsupported.generic", {
                      defaultValue:
                        "This advanced setting is not available for the current target yet.",
                    })
              }
            />
          ) : (
            child
          );

        return (
          <AccordionItem
            key={section.id}
            value={section.id}
            className="rounded-xl glass-card overflow-hidden"
          >
            <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                {SECTION_ICONS[section.id].node}
                <div className="text-left">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground font-normal">
                    {description}
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
              {content}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function UnsupportedAdvancedSection({ reason }: { reason: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">
          {t("remote.settings.advanced.unsupported.title", {
            defaultValue: "远程暂未接入",
          })}
        </p>
        <p className="text-xs leading-relaxed text-yellow-700/80 dark:text-yellow-300/80">
          {reason}
        </p>
      </div>
    </div>
  );
}

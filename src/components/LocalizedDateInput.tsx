import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

type LocalizedDateInputProps = Omit<React.ComponentPropsWithRef<"input">, "type"> & {
  type: "date" | "week";
};

/**
 * Sets `lang` on native date/week inputs so picker chrome can follow app language
 * when the browser honors it (may still follow OS locale on some platforms).
 */
export const LocalizedDateInput = forwardRef<HTMLInputElement, LocalizedDateInputProps>(
  function LocalizedDateInput({ type, lang: langOverride, ...rest }, ref) {
    const { i18n } = useTranslation();
    const lang =
      langOverride ?? (i18n.language?.toLowerCase().startsWith("ko") ? "ko" : "en");
    return <input ref={ref} type={type} lang={lang} {...rest} />;
  }
);

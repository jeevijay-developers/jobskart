import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CityTownAutocomplete } from "@/components/candidate/CityTownAutocomplete";
import { BigInput } from "@/components/wizard/Questionnaire";
import { Field } from "@/components/candidate/primitives";
import { useJobTitleSuggestions } from "@/lib/useJobTitleSuggestions";

export const Route = createFileRoute("/caltest999")({
  ssr: false,
  component: TestPage,
});

function TestPage() {
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const designationSuggestions = useJobTitleSuggestions();

  return (
    <div className="space-y-6 p-8" style={{ maxWidth: 420 }}>
      <div>
        <BigInput
          placeholder="Your full name"
          value={fullName}
          onChange={(e) => {
            const normalized = e.target.value
              .replace(/[0-9]/g, "")
              .replace(/[^A-Za-z ]+/g, " ")
              .toUpperCase();
            setFullName(normalized);
          }}
          autoFocus
        />
      </div>
      <Field label="Designation (optional)" hint="e.g. Head of TA, Founder">
        <CityTownAutocomplete
          value={designation}
          onChange={setDesignation}
          suggestions={designationSuggestions}
          minChars={3}
          maxSuggestions={10}
          placeholder="Optional"
        />
      </Field>
      <div id="debug" style={{ fontFamily: "monospace", fontSize: 12 }}>
        fullName: {JSON.stringify(fullName)} | designation: {JSON.stringify(designation)}
      </div>
    </div>
  );
}

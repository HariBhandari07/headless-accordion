import {
  ComponentType,
  createContext,
  ElementType,
  forwardRef,
  KeyboardEventHandler,
  ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
} from "react";
import { useControlledState } from "../utils/useControlledState.ts";
import {
  Descendants,
  useDescendant,
  useDescendantContext,
  useDescendants,
} from "../utils/descendants.tsx";
import { makeId } from "../utils/makeId.ts";
import type * as Polymorphic from "../utils/polymorphic.ts";
import { composeEventHandlers } from "../utils/composeEventHandlers.ts";
import { useComposedRefs } from "../utils/composeRefs.ts";

const ACCORDION_NAME = "Accordion";
const ITEM_NAME = "AccordionItem";
const BUTTON_NAME = "AccordionTrigger";
const PANEL_NAME = "AccordionPanel";
const ACCORDION_CONTEXT = "AccordionContext";
const ACCORDION_ITEM_CONTEXT = "AccordionItemContext";

const ACCORDION_ALLOWED_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

export function noop() {}

function getDataState(state: AccordionStates) {
  return state === AccordionStates.Open ? "open" : "collapsed";
}

enum AccordionStates {
  Open = "OPEN",
  Collapsed = "COLLAPSED",
}

const Accordion = forwardRef(function (
  {
    children,
    as: Comp = "div",
    defaultIndex,
    index: controlledIndex,
    onChange,
    multiple = false,
    readOnly = false,
    collapsible = false,
    ...props
  },
  forwardedRef
) {
  const [openPanels, setOpenPanels] = useControlledState({
    controlledValue: controlledIndex,
    defaultValue: () => {
      if (defaultIndex != null) {
        if (multiple) {
          // If multiple is set to true, we need to make sure the `defaultIndex`
          // is an array (and vice versa).
          return Array.isArray(defaultIndex) ? defaultIndex : [defaultIndex];
        } else {
          return Array.isArray(defaultIndex)
            ? defaultIndex[0] ?? 0
            : defaultIndex;
        }
      }
      if (collapsible) {
        // collapsible with no defaultIndex will start with all panels collapsed
        return multiple ? [] : -1;
      }
      return multiple ? [0] : 0;
    },
    calledFrom: "Accordion",
  });

  const onAccordionItemClick = useCallback(
    (index: number) => {
      onChange && onChange(index);

      setOpenPanels((prevOpenPanels) => {
        if (multiple) {
          prevOpenPanels = prevOpenPanels as number[];
          // close open  panels
          if (prevOpenPanels.includes(index)) {
            // other panels are open OR accordion is allowed to collapse
            if (prevOpenPanels.length > 1 || collapsible) {
              return prevOpenPanels.filter((i) => i !== index);
            }
          } else {
            // open panel
            return [...prevOpenPanels, index].sort();
          }
        } else {
          return prevOpenPanels === index && collapsible ? -1 : index;
        }
        return prevOpenPanels;
      });
    },
    [setOpenPanels, onChange, multiple, collapsible]
  );

  const id = useId();

  const context = useMemo(
    () => ({
      openPanels: controlledIndex ? controlledIndex : openPanels,
      onAccordionItemClick: readOnly ? noop : onAccordionItemClick,
      readOnly,
      accordionId: id,
    }),
    [onAccordionItemClick, readOnly, id, controlledIndex, openPanels]
  );

  const descendantContext = useDescendants();

  return (
    <Descendants value={descendantContext}>
      <AccordionContext.Provider value={context}>
        <Comp {...props} ref={forwardedRef} data-hb-accordion="">
          {children}
        </Comp>
      </AccordionContext.Provider>
    </Descendants>
  );
}) as Polymorphic.ForwardRefComponent<"div", AccordionProps>;

const AccordionItem = forwardRef(function (
  { children, as: Comp = "div", disabled = false, ...props },
  forwardedRef
) {
  const { openPanels, accordionId, readOnly } = useAccordionContext();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const index = useDescendant({ element: buttonRef.current });

  const state =
    (Array.isArray(openPanels)
      ? openPanels.includes(index) && AccordionStates.Open
      : openPanels === index && AccordionStates.Open) ||
    AccordionStates.Collapsed;

  const itemId = makeId(accordionId, index);
  const panelId = makeId("panel", itemId);
  const buttonId = makeId("button", itemId);

  const context = useMemo(
    () => ({
      index,
      state,
      disabled,
      itemId,
      panelId,
      buttonId,
      buttonRef,
    }),
    [index, state, disabled, itemId, panelId, buttonId]
  );

  return (
    <AccordionItemContext.Provider value={context}>
      <Comp
        {...props}
        ref={forwardedRef}
        data-hb-accordion-item=""
        data-state={getDataState(state)}
        data-disabled={disabled ? "" : undefined}
        data-read-only={readOnly ? "" : undefined}
      >
        {children}
      </Comp>
    </AccordionItemContext.Provider>
  );
}) as Polymorphic.ForwardRefComponent<"div", AccordionItemProps>;

const AccordionButton = forwardRef(function (
  { children, as: Comp = "button", onClick, onKeyDown, ...props },
  forwardedRef
) {
  const { onAccordionItemClick } = useAccordionContext();
  const {
    disabled,
    index: accordionItemIndex,
    buttonId,
    panelId,
    state,
    buttonRef,
  } = useAccordionItemContext();
  const { map } = useDescendantContext();

  const ref = useComposedRefs(forwardedRef, buttonRef);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) {
      return;
    }
    buttonRef.current?.focus();
    onAccordionItemClick(accordionItemIndex);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLButtonElement> = (e) => {
    if (!ACCORDION_ALLOWED_KEYS.includes(e.key)) return;

    let navIndex: { id: string; index: number } | Record<string, never> = {};

    const selectableDescendants = Object.entries(map.current)
      .reduce(
        (ac: Array<{ id: string; index: number }>, cv) =>
          !cv[1]?.props?.element?.disabled
            ? [...ac, { id: cv[0], index: cv[1]?.index }]
            : ac,
        []
      )
      .sort((a, b) => a.index - b.index);

    if (!selectableDescendants.length) {
      return;
    }

    const selectableIndex = selectableDescendants.findIndex(
      (descendant) => descendant?.index === accordionItemIndex
    );

    const getFirstOption = () => {
      return selectableDescendants[0];
    };

    const getLastOption = () => {
      return selectableDescendants[selectableDescendants.length - 1];
    };

    const getNextOption = () => {
      const atBottom = accordionItemIndex === getLastOption().index;
      return atBottom
        ? getFirstOption()
        : selectableDescendants[
            (selectableIndex + 1) % selectableDescendants.length
          ];
    };

    const getPrevOption = () => {
      const atTop = accordionItemIndex === getFirstOption().index;
      return atTop
        ? getLastOption()
        : selectableDescendants[
            (selectableIndex - 1 + selectableDescendants.length) %
              selectableDescendants.length
          ];
    };

    switch (e.key) {
      case "ArrowUp": {
        e.preventDefault();
        const prev = getPrevOption();
        navIndex = prev ? prev : {};
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        const next = getNextOption();
        navIndex = next ? next : {};
        break;
      }
      case "PageUp": {
        e.preventDefault();
        const prevOrFirst = (e.ctrlKey ? getPrevOption : getFirstOption)();
        navIndex = prevOrFirst ? prevOrFirst : {};
        break;
      }
      case "PageDown": {
        e.preventDefault();
        const nextOrLast = (e.ctrlKey ? getNextOption : getLastOption)();
        navIndex = nextOrLast ? nextOrLast : {};
        break;
      }
      case "Home": {
        e.preventDefault();
        const first = getFirstOption();
        navIndex = first ? first : {};
        break;
      }
      case "End": {
        e.preventDefault();
        const last = getLastOption();
        navIndex = last ? last : {};
        break;
      }
      default:
        break;
    }
    if (navIndex.id != undefined) {
      map.current[navIndex.id].props?.element?.focus();
    }
  };

  return (
    <Comp
      aria-controls={panelId}
      aria-expanded={state === AccordionStates.Open}
      {...props}
      ref={ref}
      data-hb-accordion-button=""
      onClick={composeEventHandlers(onClick, handleTriggerClick)}
      disabled={disabled || undefined}
      id={buttonId}
      onKeyDown={composeEventHandlers(onKeyDown, handleKeyDown)}
    >
      {children}
    </Comp>
  );
}) as Polymorphic.ForwardRefComponent<"button", AccordionButtonProps>;

const AccordionPanel = forwardRef(function (
  { children, as: Comp = "div", ...props },
  forwardedRef
) {
  const { state, disabled, panelId, buttonId } = useAccordionItemContext();

  return (
    <Comp
      role="region"
      aria-labelledby={buttonId}
      {...props}
      ref={forwardedRef}
      data-hb-accordion-panel=""
      hidden={state !== AccordionStates.Open}
      data-disabled={disabled || undefined}
      data-state={getDataState(state)}
      id={panelId}
    >
      {children}
    </Comp>
  );
}) as Polymorphic.ForwardRefComponent<"div", AccordionPanelProps>;

const AccordionContext = createContext<
  InternalAccordionContextValue | undefined
>(undefined);
const AccordionItemContext = createContext<
  InternalAccordionItemContextValue | undefined
>(undefined);

const useAccordionContext = () => {
  const context = useContext(AccordionContext);
  if (!context) {
    throw Error("useAccordionContext must be used within Accordion.");
  }
  return context;
};

const useAccordionItemContext = () => {
  const context = useContext(AccordionItemContext);
  if (!context) {
    throw Error("useAccordionItemContext must be used within AccordionItem.");
  }
  return context;
};

Accordion.displayName = ACCORDION_NAME;
AccordionItem.displayName = ITEM_NAME;
AccordionButton.displayName = BUTTON_NAME;
AccordionPanel.displayName = PANEL_NAME;
AccordionContext.displayName = ACCORDION_CONTEXT;
AccordionItemContext.displayName = ACCORDION_ITEM_CONTEXT;

const AccordionNamespace = Object.assign(Accordion, {
  Item: AccordionItem,
  Button: AccordionButton,
  Panel: AccordionPanel,
});

export { AccordionNamespace as Accordion };

type AccordionIndex = number | number[];

interface AccordionProps {
  children: ReactNode;
  index?: AccordionIndex;
  defaultIndex?: AccordionIndex;

  onChange?(index?: number): void;

  readOnly?: boolean;
  multiple?: boolean;
  collapsible?: boolean;
  as?: ElementType | ComponentType;
}

interface AccordionItemProps {
  as?: ElementType | ComponentType;
  children: ReactNode;
  disabled?: boolean;
}

interface AccordionButtonProps {
  as?: ElementType | ComponentType;
  children: ReactNode;
}

interface AccordionPanelProps {
  as?: ElementType | ComponentType;
  children: ReactNode;
}

interface InternalAccordionContextValue {
  openPanels: AccordionIndex;
  accordionId: string;

  onAccordionItemClick(index: AccordionIndex): void;

  readOnly: boolean;
}

interface InternalAccordionItemContextValue {
  index: number;
  disabled: boolean;
  state: AccordionStates;
  itemId: string;
  panelId: string;
  buttonId: string;
  buttonRef: React.RefObject<HTMLButtonElement>;
}

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchShippingOptions, isMototaxi, isPickup } from "./expeditionTypes";
import { fetchProviders, ServiceProvider } from "@/lib/deliveryProviders";

export interface ShippingFieldsValue {
  carrier: string;
  courier: string;
  courierProviderId: string;
  cost: string;
}

interface Props {
  value: ShippingFieldsValue;
  onChange: (v: ShippingFieldsValue) => void;
  compact?: boolean;
}

/**
 * Bloco reutilizável de envio: forma de envio (padrão + transportadoras cadastradas),
 * mototaxista cadastrado e VALOR DO ENVIO (oculto em Retirada na loja).
 */
export function ExpShippingFields({ value, onChange, compact }: Props) {
  const [options, setOptions] = useState<string[]>([]);
  const [providers, setProviders] = useState<ServiceProvider[]>([]);

  useEffect(() => {
    fetchShippingOptions().then(setOptions).catch(() => setOptions([]));
    fetchProviders(true).then(setProviders).catch(() => setProviders([]));
  }, []);

  const set = (patch: Partial<ShippingFieldsValue>) => onChange({ ...value, ...patch });
  const motos = providers.filter((p) => p.provider_type === "mototaxi");
  const h = compact ? "h-11" : "h-12";

  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div>
        <Label className="text-base font-bold">Forma de envio</Label>
        <Select value={value.carrier} onValueChange={(v) => set({ carrier: v })}>
          <SelectTrigger className={`${h} text-base`}>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s} value={s} className="text-base">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isMototaxi(value.carrier) && (
        <div>
          <Label className="text-base font-bold">Mototaxista</Label>
          {motos.length > 0 ? (
            <Select
              value={value.courierProviderId}
              onValueChange={(id) =>
                set({ courierProviderId: id, courier: motos.find((m) => m.id === id)?.name || value.courier })
              }
            >
              <SelectTrigger className={`${h} text-base`}>
                <SelectValue placeholder="Selecione o mototaxista" />
              </SelectTrigger>
              <SelectContent>
                {motos.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-base">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={value.courier}
              onChange={(e) => set({ courier: e.target.value })}
              className={`${h} text-base`}
              placeholder="Cadastre em Configurações > Prestadores"
            />
          )}
        </div>
      )}

      {!isPickup(value.carrier) && !!value.carrier && (
        <div>
          <Label className="text-base font-bold">Valor do envio (R$)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={value.cost}
            onChange={(e) => set({ cost: e.target.value })}
            className={`${h} text-base`}
            placeholder="0,00"
          />
        </div>
      )}
    </div>
  );
}

export default ExpShippingFields;

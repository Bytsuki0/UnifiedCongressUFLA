-- Ensaio revertido dos e-mails aos revisores (migration 20261014120000).
--
-- Exercita a fila DE VERDADE, no banco de produção, e desfaz tudo: o bloco
-- termina em RAISE EXCEPTION, que leva junto os INSERTs, os UPDATEs e as
-- reservas — inclusive as de associações reais que a drenagem pegar durante
-- o ensaio. Nenhum e-mail sai: quem envia é o Apps Script, e ele nunca vê
-- esta transação (no máximo espera um instante pelas linhas travadas).
--
-- Como rodar: cole no SQL Editor do dashboard do Supabase (ou mande pela
-- Management API), DEPOIS de aplicar a migration.
-- Aprovado = o erro final diz "ENSAIO OK". Qualquer outra mensagem é a
-- asserção que falhou, e ela diz qual.

DO $$
DECLARE
  -- Começa com "0" para cair cedo na ordem da fila; e .invalid não entrega nada.
  c_email CONSTANT text := '0-ensaio-emails@exemplo.invalid';
  v_admin uuid;
  v_trab  uuid;
  v_assoc uuid;
  v_n     integer;
BEGIN
  -- Drena a fila inteira (lotes de 50) e conta quantos e-mails do tipo pedido
  -- foram para o revisor de ensaio. Drenar, e não buscar um lote só: com
  -- associações reais na fila, o ensaio poderia não caber no primeiro lote.
  CREATE FUNCTION pg_temp.ensaio_drenar(_email text, _tipo text)
  RETURNS integer LANGUAGE plpgsql AS $f$
  DECLARE
    v_lote  integer;
    v_meus  integer := 0;
    v_voltas integer := 0;
    r       record;
  BEGIN
    LOOP
      -- Busca que não esvazia = reserva que não marca: a mesma linha voltaria
      -- em toda busca e o Apps Script a mandaria a cada minuto.
      v_voltas := v_voltas + 1;
      IF v_voltas > 1000 THEN
        RAISE EXCEPTION 'FALHOU: a fila não esvazia — a reserva não está marcando.';
      END IF;
      v_lote := 0;
      FOR r IN SELECT * FROM public.emails_devidos(50) LOOP
        v_lote := v_lote + 1;
        IF r.revisor_email = _email AND r.tipo = _tipo THEN
          v_meus := v_meus + 1;
        END IF;
      END LOOP;
      EXIT WHEN v_lote = 0;
    END LOOP;
    RETURN v_meus;
  END $f$;

  -- Trabalho e associação de ensaio. Sem sessão (auth.uid() nulo), o trigger
  -- de proteção do trabalho devolve cedo, como em toda escrita de servidor.
  INSERT INTO public.trabalhos (titulo, autores)
  VALUES ('Ensaio dos e-mails aos revisores', 'Ensaio')
  RETURNING id INTO v_trab;

  INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
  VALUES (v_trab, c_email, 'Revisor de Ensaio', 'avaliador')
  RETURNING id INTO v_assoc;

  IF pg_temp.ensaio_drenar(c_email, 'atribuicao') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: a designação saiu sem o co-chair liberar.';
  END IF;

  -- 1. O botão, como um admin de verdade. O JWT é simulado só nesta
  --    transação e desligado logo depois — o resto roda sem sessão.
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_n := public.solicitar_avisos_atribuicao();
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_n < 1 OR (SELECT tr.aviso_solicitado_em FROM public.trabalho_revisores tr
                  WHERE tr.id = v_assoc) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: solicitar_avisos_atribuicao não pôs o ensaio na fila (devolveu %).', v_n;
  END IF;

  -- 2. A designação sai uma vez; a reserva segura a busca seguinte.
  IF pg_temp.ensaio_drenar(c_email, 'atribuicao') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: a designação liberada não saiu exatamente uma vez.';
  END IF;
  IF pg_temp.ensaio_drenar(c_email, 'atribuicao') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: a designação saiu de novo — a reserva não segurou.';
  END IF;

  -- 3. Devolvida (envio falhou no Apps Script), volta para a fila.
  IF public.devolver_emails('atribuicao', ARRAY[v_assoc]) <> 1
     OR pg_temp.ensaio_drenar(c_email, 'atribuicao') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: a designação devolvida não voltou para a fila.';
  END IF;

  -- 4. Lembrete: prazo amanhã com 72 h de antecedência (janela já aberta),
  --    revisor avisado há 10 dias. Uma vez por prazo.
  UPDATE public.trabalho_revisores SET aviso_enviado_em = now() - interval '10 days'
   WHERE id = v_assoc;
  UPDATE public.configuracoes
     SET revisoes_encerramento = public.data_local() + 1, alerta_horas = 72
   WHERE id;
  IF pg_temp.ensaio_drenar(c_email, 'lembrete') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: o lembrete não saiu dentro da janela.';
  END IF;
  IF pg_temp.ensaio_drenar(c_email, 'lembrete') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: o lembrete saiu duas vezes para o mesmo prazo.';
  END IF;

  -- 5. Atraso: prazo ontem. Uma vez só.
  UPDATE public.configuracoes SET revisoes_encerramento = public.data_local() - 1 WHERE id;
  IF pg_temp.ensaio_drenar(c_email, 'atraso') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: o aviso de atraso não saiu com o prazo vencido.';
  END IF;
  IF pg_temp.ensaio_drenar(c_email, 'atraso') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: o aviso de atraso saiu duas vezes para o mesmo prazo.';
  END IF;

  -- 6. Só cobra quem sabia: avisado DEPOIS do prazo, não recebe atraso.
  UPDATE public.trabalho_revisores SET atraso_prazo = NULL, aviso_enviado_em = now()
   WHERE id = v_assoc;
  IF pg_temp.ensaio_drenar(c_email, 'atraso') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: cobrou atraso de quem só foi avisado depois do prazo.';
  END IF;

  -- 7. Trabalho decidido não cobra parecer de ninguém.
  UPDATE public.trabalho_revisores SET aviso_enviado_em = now() - interval '10 days'
   WHERE id = v_assoc;
  UPDATE public.trabalhos SET status = 'aprovado' WHERE id = v_trab;
  IF pg_temp.ensaio_drenar(c_email, 'atraso') <> 0 THEN
    RAISE EXCEPTION 'FALHOU: cobrou parecer de um trabalho já decidido.';
  END IF;

  -- 8. Prorrogar o prazo rearma o lembrete (a data guardada deixa de bater).
  UPDATE public.trabalhos SET status = 'em_avaliacao' WHERE id = v_trab;
  UPDATE public.configuracoes SET revisoes_encerramento = public.data_local() + 2 WHERE id;
  IF pg_temp.ensaio_drenar(c_email, 'lembrete') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: prorrogar o prazo não rearmou o lembrete.';
  END IF;

  RAISE EXCEPTION 'ENSAIO OK — tudo desfeito, nenhum e-mail saiu.';
END $$;

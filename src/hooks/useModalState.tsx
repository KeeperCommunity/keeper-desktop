import { useState } from "react";

export type ModalType =
  | "deviceAction"
  | "deviceActionSuccess"
  | "notFound"
  | "multipleDevices"
  | "error"
  | "pin"
  | "onekeyPin"
  | null;

const useModalState = () => {
  const [openModal, setOpenModal] = useState<ModalType>(null);

  const openModalHandler = (modal: ModalType) => setOpenModal(modal);
  const closeModalHandler = () => setOpenModal(null);

  return {
    openModal,
    openModalHandler,
    closeModalHandler,
  };
};

export default useModalState;
